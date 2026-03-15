import os
import datetime
import requests
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, jsonify, request
from flask_cors import CORS
from steam_web_api import Steam
from dotenv import load_dotenv

load_dotenv()

KEY = os.getenv("STEAM_API_KEY", "")
DEFAULT_STEAM_ID = os.getenv("STEAM_ID", "")

steam = Steam(KEY)
app = Flask(__name__)
CORS(app)

_SUMMARIES_URL = (
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/"
)
_FRIEND_LIST_URL = "https://api.steampowered.com/ISteamUser/GetFriendList/v1/"
_OWNED_GAMES_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
_APP_DETAILS_URL = "https://store.steampowered.com/api/appdetails"
_MAX_WORKERS = int(os.getenv("LIBRARY_MAX_WORKERS", "40"))


# ── helpers ─────────────────────────────────────────────────────────────────

def _format_player(player: dict) -> dict:
    logoff = player.get("lastlogoff")
    return {
        "steamid": player.get("steamid"),
        "name": player.get("personaname"),
        "avatar": player.get("avatarfull"),
        "profile_url": player.get("profileurl"),
        "state": player.get("personastate"),
        "country": player.get("loccountrycode"),
        "last_logoff": (
            str(datetime.datetime.fromtimestamp(logoff)) if logoff else None
        ),
    }


def _bulk_player_summaries(steam_ids: list[str]) -> list[dict]:
    """
    Fetch player summaries in batches of 100 (Steam API limit).
    Time: O(ceil(N/100)) API calls — much better than O(N) one-by-one calls.
    Space: O(N) for the returned list.
    """
    results: list[dict] = []
    for i in range(0, len(steam_ids), 100):
        chunk = steam_ids[i : i + 100]
        resp = requests.get(
            _SUMMARIES_URL,
            params={"key": KEY, "steamids": ",".join(chunk)},
            timeout=10,
        )
        resp.raise_for_status()
        players = resp.json().get("response", {}).get("players", [])
        results.extend(players)
    return results


def _get_friend_ids(steam_id: str) -> list[str]:
    resp = requests.get(
        _FRIEND_LIST_URL,
        params={"key": KEY, "steamid": steam_id, "relationship": "friend"},
        timeout=10,
    )
    resp.raise_for_status()
    return [
        f.get("steamid")
        for f in resp.json().get("friendslist", {}).get("friends", [])
        if f.get("steamid")
    ]


def _fetch_owned_games_for_id(steam_id: str) -> tuple[str, list[dict]]:
    """Returns (steam_id, games). Returns [] for private profiles/errors."""
    try:
        resp = requests.get(
            _OWNED_GAMES_URL,
            params={
                "key": KEY,
                "steamid": steam_id,
                "include_appinfo": True,
                "include_played_free_games": True,
            },
            timeout=10,
        )
        resp.raise_for_status()
        games = resp.json().get("response", {}).get("games", [])
        return steam_id, games
    except Exception:
        return steam_id, []


def _is_family_sharable(app_id: int) -> bool:
    """Returns True when Steam app category contains Family Sharing (id=62)."""
    try:
        resp = requests.get(
            _APP_DETAILS_URL,
            params={"appids": app_id, "filters": "categories"},
            timeout=10,
        )
        resp.raise_for_status()
        info = resp.json().get(str(app_id), {})
        if not info.get("success"):
            return False
        cats = info.get("data", {}).get("categories", [])
        return any(c.get("id") == 62 for c in cats)
    except Exception:
        return False


def _sort_by_name(ids: set[int], names: dict[int, str]) -> list[int]:
    return sorted(ids, key=lambda aid: names.get(aid, "").casefold())


def _to_game_item(app_id: int, meta: dict, source: str) -> dict:
    return {
        "appid": app_id,
        "name": meta.get("name") or str(app_id),
        "img_icon_url": meta.get("img_icon_url"),
        "playtime_forever_hrs": round(meta.get("playtime_forever", 0) / 60, 2),
        "source": source,
    }


# ── routes ──────────────────────────────────────────────────────────────────

@app.route("/api/config", methods=["GET"])
def config():
    """Return the default Steam ID loaded from .env so the frontend
    can auto-load without any manual input."""
    return jsonify({"steam_id": DEFAULT_STEAM_ID})


@app.route("/api/user", methods=["GET"])
def user_details():
    steam_id = request.args.get("steam_id", DEFAULT_STEAM_ID).strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    try:
        res = steam.users.get_user_details(steam_id)
        player = res.get("player", {})
        if not player:
            return jsonify({"error": "User not found"}), 404
        return jsonify(_format_player(player))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/friends", methods=["GET"])
def friends_list():
    steam_id = request.args.get("steam_id", DEFAULT_STEAM_ID).strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    try:
        friends_raw = (
            steam.users.get_user_friends_list(steam_id).get("friends", [])
        )
        if not friends_raw:
            return jsonify([])
        ids = [f["steamid"] for f in friends_raw if f.get("steamid")]
        # Single batched call instead of one call per friend — O(1) vs O(N)
        players = _bulk_player_summaries(ids)
        return jsonify([_format_player(p) for p in players])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/recently-played", methods=["GET"])
def recently_played():
    steam_id = request.args.get("steam_id", DEFAULT_STEAM_ID).strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    try:
        games = steam.users.get_user_recently_played_games(steam_id).get(
            "games", []
        )
        result = [
            {
                "appid": g.get("appid"),
                "name": g.get("name"),
                "playtime_2weeks_hrs": round(
                    g.get("playtime_2weeks", 0) / 60, 2
                ),
                "playtime_forever_hrs": round(
                    g.get("playtime_forever", 0) / 60, 2
                ),
                "img_icon_url": g.get("img_icon_url"),
            }
            for g in games
        ]
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/owned-games", methods=["GET"])
def owned_games():
    steam_id = request.args.get("steam_id", DEFAULT_STEAM_ID).strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    try:
        data = steam.users.get_owned_games(steam_id)
        games = data.get("games", [])
        # In-place sort: O(N log N) time, O(1) extra space
        games.sort(key=lambda x: x.get("playtime_forever", 0), reverse=True)
        result = [
            {
                "appid": g.get("appid"),
                "name": g.get("name"),
                "playtime_forever_hrs": round(
                    g.get("playtime_forever", 0) / 60, 2
                ),
                "img_icon_url": g.get("img_icon_url"),
            }
            for g in games
        ]
        return jsonify({"game_count": data.get("game_count", 0), "games": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/library-catalog", methods=["GET"])
def library_catalog():
    """
    Fast family-library view:
    1) get friend IDs (1 call)
    2) get owned games for self + friends (parallel)
    3) check family-sharing category for unique app IDs (parallel)
    """
    steam_id = request.args.get("steam_id", DEFAULT_STEAM_ID).strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    if not KEY:
        return jsonify({"error": "STEAM_API_KEY is missing"}), 500

    try:
        friend_ids = _get_friend_ids(steam_id)
    except Exception as e:
        return jsonify({"error": f"Could not fetch friend list: {e}"}), 500

    all_ids = [steam_id] + friend_ids
    my_appids: set[int] = set()
    friend_appids: set[int] = set()
    app_names: dict[int, str] = {}
    app_meta: dict[int, dict] = {}

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for sid, games in pool.map(_fetch_owned_games_for_id, all_ids):
            for g in games:
                aid = g.get("appid")
                if not aid:
                    continue
                app_names.setdefault(aid, g.get("name") or str(aid))
                app_meta.setdefault(
                    aid,
                    {
                        "name": g.get("name") or str(aid),
                        "img_icon_url": g.get("img_icon_url"),
                        "playtime_forever": 0,
                    },
                )
                if sid == steam_id:
                    my_appids.add(aid)
                    app_meta[aid]["playtime_forever"] = g.get("playtime_forever", 0)
                    if g.get("img_icon_url"):
                        app_meta[aid]["img_icon_url"] = g.get("img_icon_url")
                else:
                    friend_appids.add(aid)
                    if not app_meta[aid].get("img_icon_url") and g.get("img_icon_url"):
                        app_meta[aid]["img_icon_url"] = g.get("img_icon_url")

    friend_only_appids = friend_appids - my_appids

    sharable_ids: set[int] = set()
    unique_app_ids = list(app_names.keys())
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for aid, is_ok in zip(unique_app_ids, pool.map(_is_family_sharable, unique_app_ids)):
            if is_ok:
                sharable_ids.add(aid)

    all_games_ids = my_appids | (friend_only_appids & sharable_ids)
    owned_games_ids = my_appids
    family_games_ids = friend_only_appids & sharable_ids

    all_games = [
        _to_game_item(aid, app_meta.get(aid, {}), "family_share" if aid in family_games_ids else "owned")
        for aid in _sort_by_name(all_games_ids, app_names)
    ]
    owned_games_list = [
        _to_game_item(aid, app_meta.get(aid, {}), "owned")
        for aid in _sort_by_name(owned_games_ids, app_names)
    ]
    family_games_list = [
        _to_game_item(aid, app_meta.get(aid, {}), "family_share")
        for aid in _sort_by_name(family_games_ids, app_names)
    ]

    return jsonify(
        {
            "counts": {
                "friends": len(friend_ids),
                "all_games": len(all_games),
                "owned_games": len(owned_games_list),
                "family_sharing_games": len(family_games_list),
            },
            "all_games": all_games,
            "owned_games": owned_games_list,
            "family_sharing_games": family_games_list,
        }
    )


@app.route("/api/search-games", methods=["GET"])
def search_games():
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    try:
        results = steam.apps.search_games(query).get("apps", [])
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/game-details", methods=["GET"])
def game_details():
    appid_str = request.args.get("appid", "").strip()
    if not appid_str:
        return jsonify({"error": "appid is required"}), 400
    try:
        appid = int(appid_str)
    except ValueError:
        return jsonify({"error": "appid must be an integer"}), 400
    try:
        res = steam.apps.get_app_details(appid)
        data = res.get(str(appid), {}).get("data", {})
        if not data:
            return jsonify({"error": "Game not found"}), 404
        return jsonify(
            {
                "appid": appid,
                "name": data.get("name"),
                "type": data.get("type"),
                "developers": data.get("developers"),
                "publishers": data.get("publishers"),
                "description": data.get("short_description"),
                "header_image": data.get("header_image"),
                "website": data.get("website"),
                "genres": [
                    g.get("description") for g in data.get("genres", [])
                ],
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


_STEAM_FEATURED_URL = "https://store.steampowered.com/api/featuredcategories/"


@app.route("/api/steam-deals", methods=["GET"])
def steam_deals():
    """
    Returns featured discounted games from the Steam store.
    Uses Steam's public featuredcategories API — no key required.
    Falls back to an empty list on any error.
    """
    try:
        resp = requests.get(
            _STEAM_FEATURED_URL,
            params={"cc": "US", "l": "english"},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        specials = data.get("specials", {}).get("items", [])
        result = []
        for item in specials:               # filter first, then cap
            if not item.get("discount_percent", 0):
                continue
            orig = item.get("original_price", 0)
            final = item.get("final_price", 0)
            orig_fmt = f"${orig / 100:.2f}" if orig else ""
            appid = item.get("id", 0)
            result.append({
                "title": item.get("name", ""),
                "thumbnail": item.get("small_capsule_image", ""),
                "url": f"https://store.steampowered.com/app/{appid}/",
                "discount": item.get("discount_percent", 0),
                "original_price": orig_fmt,
                "final_price": f"${final / 100:.2f}" if final else "Free",
            })
            if len(result) >= 12:
                break
        return jsonify(result)
    except Exception:
        return jsonify([])


_EPIC_FREE_URL = (
    "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions"
    "?locale=en-US&country=US&allowCountries=US"
)


@app.route("/api/free-games", methods=["GET"])
def free_games():
    """
    Returns currently free games from the Epic Games Store.
    Falls back to an empty list on any network/parse error so the
    frontend never shows a hard failure.
    """
    try:
        resp = requests.get(_EPIC_FREE_URL, timeout=8)
        resp.raise_for_status()
        elements = (
            resp.json()
            .get("data", {})
            .get("Catalog", {})
            .get("searchStore", {})
            .get("elements", [])
        )
        result = []
        for el in elements:
            promos = el.get("promotions") or {}
            current = promos.get("promotionalOffers", [])
            # A game is currently free when it has at least one active
            # promotional offer whose discountPercentage == 0 (i.e. 100 % off)
            is_free = any(
                offer.get("discountSetting", {}).get("discountPercentage", -1) == 0
                for promo in current
                for offer in promo.get("promotionalOffers", [])
            )
            if not is_free:
                continue
            # Pick the best available thumbnail (wide keyart preferred)
            thumb = ""
            for img in el.get("keyImages", []):
                if img.get("type") in ("OfferImageWide", "Thumbnail", "DieselStoreFrontWide"):
                    thumb = img.get("url", "")
                    break
            slug = el.get("catalogNs", {}).get("mappings", [{}])[0].get("pageSlug", "")
            url = f"https://store.epicgames.com/en-US/p/{slug}" if slug else "https://store.epicgames.com/en-US/free-games"
            result.append({
                "title": el.get("title", ""),
                "thumbnail": thumb,
                "url": url,
                "source": "EPIC",
            })
        return jsonify(result)
    except Exception as e:
        return jsonify([])


if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, port=5000)

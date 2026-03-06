import os
import datetime
import requests
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


if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, port=5000)

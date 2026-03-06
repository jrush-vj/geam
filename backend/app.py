import os
import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS
from steam_web_api import Steam

# ======= CONFIG FROM ENV =======
KEY = os.getenv("STEAM_API_KEY", "")
STEAM_ID = os.getenv("STEAM_ID", "")

if not KEY:
    import sys
    print("ERROR: STEAM_API_KEY is not set. Please add it to backend/.env", file=sys.stderr)

steam = Steam(KEY)

app = Flask(__name__)
CORS(app)


def _format_player(player):
    logoff = player.get("lastlogoff")
    return {
        "steamid": player.get("steamid"),
        "name": player.get("personaname"),
        "avatar": player.get("avatarfull"),
        "profile_url": player.get("profileurl"),
        "state": player.get("personastate"),
        "country": player.get("loccountrycode"),
        "last_logoff": str(datetime.datetime.fromtimestamp(logoff)) if logoff else None,
    }


@app.route("/api/config", methods=["GET"])
def get_config():
    """Expose non-sensitive config (Steam ID) to the frontend."""
    return jsonify({"steam_id": STEAM_ID})


@app.route("/api/user", methods=["GET"])
def user_details():
    steam_id = request.args.get("steam_id", "").strip()
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
    steam_id = request.args.get("steam_id", "").strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    try:
        friends_raw = steam.users.get_user_friends_list(steam_id).get("friends", [])
        if not friends_raw:
            return jsonify([])
        # Batch-fetch all friend summaries (up to 100 IDs per request)
        friend_steam_ids = [f.get("steamid") for f in friends_raw if f.get("steamid")]
        players = []
        batch_size = 100
        for i in range(0, len(friend_steam_ids), batch_size):
            chunk = friend_steam_ids[i:i + batch_size]
            res = steam.users.get_user_details(",".join(chunk))
            raw = res.get("players", res.get("player"))
            if isinstance(raw, list):
                players.extend(raw)
            elif isinstance(raw, dict):
                players.append(raw)
        return jsonify([_format_player(p) for p in players])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/recently-played", methods=["GET"])
def recently_played():
    steam_id = request.args.get("steam_id", "").strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    try:
        games = steam.users.get_user_recently_played_games(steam_id).get("games", [])
        result = [
            {
                "appid": g.get("appid"),
                "name": g.get("name"),
                "playtime_2weeks_hrs": round(g.get("playtime_2weeks", 0) / 60, 2),
                "playtime_forever_hrs": round(g.get("playtime_forever", 0) / 60, 2),
                "img_icon_url": g.get("img_icon_url"),
            }
            for g in games
        ]
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/owned-games", methods=["GET"])
def owned_games():
    steam_id = request.args.get("steam_id", "").strip()
    if not steam_id:
        return jsonify({"error": "steam_id is required"}), 400
    try:
        data = steam.users.get_owned_games(steam_id)
        games = data.get("games", [])
        games.sort(key=lambda x: x.get("playtime_forever", 0), reverse=True)
        result = [
            {
                "appid": g.get("appid"),
                "name": g.get("name"),
                "playtime_forever_hrs": round(g.get("playtime_forever", 0) / 60, 2),
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
        return jsonify({
            "appid": appid,
            "name": data.get("name"),
            "type": data.get("type"),
            "developers": data.get("developers"),
            "publishers": data.get("publishers"),
            "description": data.get("short_description"),
            "header_image": data.get("header_image"),
            "website": data.get("website"),
            "genres": [g.get("description") for g in data.get("genres", [])],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, port=5000)
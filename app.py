import os
import datetime
from steam_web_api import Steam

# ======= API KEYS =======
KEY = "C6915E5B9AA98A9B18AC84B20C7CE0ED"
ACCESS_TOKEN = "76561199168719281"
steam = Steam(KEY)

STEAM_ID = "76561199168719281"

def print_header(title):
    print("\n" + "="*60)
    print(title.center(60))
    print("="*60)

def show_user_details():
    print_header("USER DETAILS")
    res = steam.users.get_user_details(STEAM_ID)
    player = res.get("player", {})
    print(f"SteamID     : {player.get('steamid')}")
    print(f"Name        : {player.get('personaname')}")
    print(f"Status      : {player.get('personastate')}")
    print(f"Profile URL : {player.get('profileurl')}")
    print(f"Country     : {player.get('loccountrycode')}")
    logoff = player.get("lastlogoff")
    if logoff:
        print(f"Last Logoff : {datetime.datetime.fromtimestamp(logoff)}")
    else:
        print("Last Logoff : Unknown")

def show_friends_list():
    print_header("FRIENDS LIST (WITH DETAILS)")
    friends_raw = steam.users.get_user_friends_list(STEAM_ID).get("friends", [])
    if not friends_raw:
        print("No friends or profile private!")
        return

    # We want to fetch details for each friend
    for f in friends_raw:
        sid = f.get("steamid")
        details = steam.users.get_user_details(sid).get("player", {})
        print(f"\nFriend SteamID : {sid}")
        print(f"  Name     : {details.get('personaname')}")
        print(f"  Profile  : {details.get('profileurl')}")
        print(f"  State    : {details.get('personastate')}")
        country = details.get("loccountrycode")
        if country:
            print(f"  Country  : {country}")
        logoff = details.get("lastlogoff")
        if logoff:
            print(f"  Last Seen: {datetime.datetime.fromtimestamp(logoff)}")

def show_recently_played():
    print_header("RECENTLY PLAYED GAMES")
    data = steam.users.get_user_recently_played_games(STEAM_ID).get("games", [])
    if not data:
        print("No recently played games!")
        return
    for g in data:
        hrs = round(g.get("playtime_2weeks",0)/60,2)
        print(f"{g.get('name')} — {hrs} hrs last 2 weeks")

def show_owned_games():
    print_header("OWNED GAMES")
    data = steam.users.get_owned_games(STEAM_ID)
    games = data.get("games", [])
    games.sort(key=lambda x: x.get("playtime_forever",0), reverse=True)
    print(f"Total Owned Games: {data.get('game_count',0)}")
    for i, g in enumerate(games,1):
        hrs = round(g.get("playtime_forever",0)/60,2)
        print(f"{i}. {g.get('name')} — {hrs} hrs")

def show_shared_games():
    print_header("FAMILY / SHARED GAMES (INCLUDING OWNED)")
    try:
        data = steam.users.get_shared_games(STEAM_ID, ACCESS_TOKEN, include_owned=True)
    except Exception as e:
        print("Error fetching shared games.")
        print("Make sure ACCESS_TOKEN is valid.")
        return

    total = data.get("game_count", 0)
    games = data.get("games", [])
    print(f"Total Shared + Owned Games: {total}\n")
    games.sort(key=lambda x: x.get("playtime_forever",0), reverse=True)
    for i, g in enumerate(games,1):
        hrs = round(g.get("playtime_forever",0)/60,2)
        print(f"{i}. {g.get('name')} — {hrs} hrs")

def search_games():
    print_header("SEARCH GAMES")
    query = input("Enter game search term: ")
    results = steam.apps.search_games(query).get("apps", [])
    if not results:
        print("No games found!")
        return
    for i, g in enumerate(results,1):
        print(f"{i}. {g.get('name')} (AppID: {g.get('appid')})")

def show_app_details():
    print_header("GAME DETAILS")
    appid = input("Enter AppID: ")
    try:
        appid = int(appid)
    except:
        print("Invalid AppID!")
        return
    res = steam.apps.get_app_details(appid)
    data = res.get(str(appid), {}).get("data", {})
    if not data:
        print("No details found!")
        return
    print(f"Name       : {data.get('name')}")
    print(f"Type       : {data.get('type')}")
    print(f"Developers : {data.get('developers')}")
    print(f"Publishers : {data.get('publishers')}")
    print(f"Desc       : {data.get('short_description')}")

def main_menu():
    while True:
        print("\n--- STEAM API MENU ---")
        print("1) User Details")
        print("2) Friends List (Full)")
        print("3) Recently Played")
        print("4) Owned Games")
        print("5) Shared / Family Games")
        print("6) Search Games")
        print("7) Game Details")
        print("0) Exit")
        choice = input("Enter choice: ")

        if choice == "1":
            show_user_details()
        elif choice == "2":
            show_friends_list()
        elif choice == "3":
            show_recently_played()
        elif choice == "4":
            show_owned_games()
        elif choice == "5":
            show_shared_games()
        elif choice == "6":
            search_games()
        elif choice == "7":
            show_app_details()
        elif choice == "0":
            print("Goodbye!")
            break
        else:
            print("Invalid, try again.")

if __name__ == "__main__":
    main_menu()
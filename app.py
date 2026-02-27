from flask import Flask, render_template, redirect, url_for, request, session
from flask_dotenv import DotEnv
import requests
import urllib.parse
from steam import Steam
from bs4 import BeautifulSoup

app = Flask(__name__)
app.secret_key = 'your_secret_key'  # Replace with a secure key

# Load environment variables
env = DotEnv()
env.init_app(app)

STEAM_API_KEY = app.config.get('STEAM_API_KEY')
STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login')
def login():
    # Redirect to Steam OpenID login
    params = {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': url_for('callback', _external=True),
        'openid.realm': request.host_url,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
    }
    query_string = urllib.parse.urlencode(params)
    return redirect(f"{STEAM_OPENID_URL}?{query_string}")

@app.route('/callback')
def callback():
    # Handle Steam OpenID callback
    steam_id = request.args.get('openid.claimed_id')
    if steam_id:
        steam_id = steam_id.split('/')[-1]
        session['steam_id'] = steam_id
        return redirect(url_for('games'))
    return redirect(url_for('home'))

@app.route('/games')
def games():
    steam_id = session.get('steam_id')
    if not steam_id:
        return redirect(url_for('home'))

    # Initialize Steam API
    steam = Steam(STEAM_API_KEY)

    # Fetch user's games
    user_games = steam.apps.get_owned_games(steam_id)

    # Fetch family shared games (example logic, replace with actual API call if needed)
    family_games = []  # Replace with actual logic to fetch family games

    # Fetch user profile
    user_profile = steam.users.get_user_summaries(steam_id)

    return render_template('games.html', games=user_games, family_games=family_games, profile=user_profile)

if __name__ == '__main__':
    app.run(debug=True)
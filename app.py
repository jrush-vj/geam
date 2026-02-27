import os
from flask import Flask, render_template, redirect, url_for, request, session
import requests
import urllib.parse
from steam import Steam
from bs4 import BeautifulSoup

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'your_secret_key')

# Load environment variables from .env if available (local dev)
try:
    from flask_dotenv import DotEnv
    env = DotEnv()
    env.init_app(app)
except ImportError:
    pass

STEAM_API_KEY = os.environ.get('STEAM_API_KEY') or app.config.get('STEAM_API_KEY')
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
    user_games = steam.users.get_owned_games(steam_id)

    # Fetch family shared games (example logic, replace with actual API call if needed)
    family_games = []  # Replace with actual logic to fetch family games

    # Fetch user profile
    user_profile = steam.users.get_user_summaries(steam_id)

    return render_template('games.html', games=user_games, family_games=family_games, profile=user_profile)

if __name__ == '__main__':
    app.run(debug=True)
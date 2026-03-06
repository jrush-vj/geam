// API base URL — override by setting window.GEAM_API_BASE before this script loads,
// or update this default for your deployment environment.
const API_BASE = (typeof window.GEAM_API_BASE !== "undefined" ? window.GEAM_API_BASE : "http://localhost:5000/api");

// ===== State =====
let currentSteamId = "";

// ===== Helpers =====
function $(id) { return document.getElementById(id); }

function showError(msg) {
  const el = $("error-banner");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearError() {
  $("error-banner").classList.add("hidden");
}

function setLoading(containerId, msg = "Loading…") {
  $(containerId).innerHTML = `<p class="loading"><span class="spinner"></span>${msg}</p>`;
}

function stateLabel(state) {
  const map = { 0: "Offline", 1: "Online", 2: "Busy", 3: "Away", 4: "Snooze", 5: "Looking to trade", 6: "Looking to play" };
  return map[state] ?? "Unknown";
}

function stateClass(state) {
  if (state === 1) return "status-online";
  if (state === 3 || state === 2) return "status-away";
  return "status-offline";
}

function gameIconUrl(appid, iconHash) {
  if (!iconHash) return null;
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${iconHash}.jpg`;
}

// ===== API calls =====
async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ===== Auto-populate Steam ID from backend config =====
async function loadConfig() {
  try {
    const cfg = await apiFetch("/config");
    if (cfg.steam_id) {
      $("steam-id-input").value = cfg.steam_id;
      $("steam-id-input").placeholder = cfg.steam_id;
    }
  } catch (err) {
    console.debug("Config load failed (non-critical):", err);
    // Config endpoint is optional — silently ignore failures
  }
}

// ===== Load profile =====
async function loadProfile() {
  clearError();
  const steamId = $("steam-id-input").value.trim();
  if (!steamId) { showError("Please enter a Steam ID."); return; }
  currentSteamId = steamId;

  try {
    const user = await apiFetch(`/user?steam_id=${encodeURIComponent(steamId)}`);
    renderProfile(user);
    $("profile-section").classList.remove("hidden");
    $("tabs-section").classList.remove("hidden");
    // Load friends by default
    loadFriends();
  } catch (err) {
    showError(`Failed to load profile: ${err.message}`);
    $("profile-section").classList.add("hidden");
    $("tabs-section").classList.add("hidden");
  }
}

function renderProfile(user) {
  $("profile-avatar").src = user.avatar || "";
  $("profile-name").textContent = user.name || user.steamid;
  $("profile-url").innerHTML = user.profile_url
    ? `<a href="${user.profile_url}" target="_blank" rel="noopener">${user.profile_url}</a>`
    : "";
  $("profile-country").textContent = user.country ? `Country: ${user.country}` : "";
  $("profile-logoff").textContent = user.last_logoff ? `Last seen: ${user.last_logoff}` : "";
  const badge = $("profile-state");
  badge.textContent = stateLabel(user.state);
  badge.className = `status-badge ${stateClass(user.state)}`;
}

// ===== Friends =====
async function loadFriends() {
  setLoading("friends-list");
  try {
    const friends = await apiFetch(`/friends?steam_id=${encodeURIComponent(currentSteamId)}`);
    if (!friends.length) {
      $("friends-list").innerHTML = "<p class='loading'>No friends found or profile is private.</p>";
      return;
    }
    $("friends-list").innerHTML = friends.map(f => `
      <div class="card">
        <img src="${f.avatar || ''}" alt="${f.name}" />
        <span class="card-name">${f.name || f.steamid}</span>
        <span class="card-meta">${stateLabel(f.state)}</span>
        ${f.country ? `<span class="card-meta">📍 ${f.country}</span>` : ""}
        ${f.profile_url ? `<a href="${f.profile_url}" target="_blank" rel="noopener">View Profile</a>` : ""}
      </div>
    `).join("");
  } catch (err) {
    $("friends-list").innerHTML = `<p class="loading">Error: ${err.message}</p>`;
  }
}

// ===== Recently Played =====
async function loadRecentlyPlayed() {
  setLoading("recently-played-list");
  try {
    const games = await apiFetch(`/recently-played?steam_id=${encodeURIComponent(currentSteamId)}`);
    if (!games.length) {
      $("recently-played-list").innerHTML = "<p class='loading'>No recently played games.</p>";
      return;
    }
    $("recently-played-list").innerHTML = games.map(g => {
      const icon = gameIconUrl(g.appid, g.img_icon_url);
      return `
        <div class="card">
          ${icon ? `<img src="${icon}" alt="${g.name}" />` : ""}
          <span class="card-name">${g.name}</span>
          <span class="card-meta">Last 2 weeks: ${g.playtime_2weeks_hrs} hrs</span>
          <span class="card-meta">Total: ${g.playtime_forever_hrs} hrs</span>
        </div>
      `;
    }).join("");
  } catch (err) {
    $("recently-played-list").innerHTML = `<p class="loading">Error: ${err.message}</p>`;
  }
}

// ===== Owned Games =====
async function loadOwnedGames() {
  setLoading("owned-games-list");
  try {
    const data = await apiFetch(`/owned-games?steam_id=${encodeURIComponent(currentSteamId)}`);
    $("owned-count").textContent = `Total games: ${data.game_count}`;
    if (!data.games.length) {
      $("owned-games-list").innerHTML = "<p class='loading'>No games found or library is private.</p>";
      return;
    }
    $("owned-games-list").innerHTML = data.games.map(g => {
      const icon = gameIconUrl(g.appid, g.img_icon_url);
      return `
        <div class="card">
          ${icon ? `<img src="${icon}" alt="${g.name}" />` : ""}
          <span class="card-name">${g.name}</span>
          <span class="card-meta">${g.playtime_forever_hrs} hrs played</span>
        </div>
      `;
    }).join("");
  } catch (err) {
    $("owned-games-list").innerHTML = `<p class="loading">Error: ${err.message}</p>`;
  }
}

// ===== Game Search =====
async function searchGames() {
  const query = $("game-search-input").value.trim();
  if (!query) return;
  setLoading("search-results");
  $("game-details-panel").classList.add("hidden");
  try {
    const results = await apiFetch(`/search-games?query=${encodeURIComponent(query)}`);
    if (!results.length) {
      $("search-results").innerHTML = "<p class='loading'>No games found.</p>";
      return;
    }
    $("search-results").innerHTML = results.map(g => `
      <div class="card">
        <span class="card-name">${g.name}</span>
        <span class="card-meta">AppID: ${g.appid}</span>
        <button class="details-btn" data-appid="${g.appid}">View Details</button>
      </div>
    `).join("");
    $("search-results").querySelectorAll(".details-btn").forEach(btn => {
      btn.addEventListener("click", () => loadGameDetails(btn.dataset.appid));
    });
  } catch (err) {
    $("search-results").innerHTML = `<p class="loading">Error: ${err.message}</p>`;
  }
}

async function loadGameDetails(appid) {
  const panel = $("game-details-panel");
  panel.innerHTML = "<p class='loading'>Loading game details…</p>";
  panel.classList.remove("hidden");
  try {
    const g = await apiFetch(`/game-details?appid=${encodeURIComponent(appid)}`);
    panel.innerHTML = `
      ${g.header_image ? `<img src="${g.header_image}" alt="${g.name}" />` : ""}
      <h3>${g.name}</h3>
      ${g.description ? `<p>${g.description}</p>` : ""}
      <p><strong>Developers:</strong> ${(g.developers || []).join(", ") || "N/A"}</p>
      <p><strong>Publishers:</strong> ${(g.publishers || []).join(", ") || "N/A"}</p>
      ${g.genres && g.genres.length ? `<p>${g.genres.map(genre => `<span class="tag">${genre}</span>`).join("")}</p>` : ""}
      ${g.website ? `<p><a href="${g.website}" target="_blank" rel="noopener">${g.website}</a></p>` : ""}
    `;
  } catch (err) {
    panel.innerHTML = `<p class="loading">Error: ${err.message}</p>`;
  }
}

// ===== Tab switching =====
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.add("active");

    // Lazy-load tab data
    if (!currentSteamId) return;
    if (btn.dataset.tab === "friends") loadFriends();
    else if (btn.dataset.tab === "recently-played") loadRecentlyPlayed();
    else if (btn.dataset.tab === "owned-games") loadOwnedGames();
  });
});

// ===== Event listeners =====
$("load-btn").addEventListener("click", loadProfile);
$("steam-id-input").addEventListener("keydown", e => { if (e.key === "Enter") loadProfile(); });
$("game-search-btn").addEventListener("click", searchGames);
$("game-search-input").addEventListener("keydown", e => { if (e.key === "Enter") searchGames(); });

// ===== Initialise =====
loadConfig();


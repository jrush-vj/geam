// API base URL — override by setting window.GEAM_API_BASE before this script loads.
const API_BASE = (typeof window.GEAM_API_BASE !== "undefined" ? window.GEAM_API_BASE : "http://localhost:5000/api");

// ===== State =====
let currentSteamId = "";
let cachedFriends = [];
let libraryLoaded = false;

// ===== Helpers =====
function $(id) { return document.getElementById(id); }

function showError(msg) {
  const el = $("error-banner");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearError() { $("error-banner").classList.add("hidden"); }

function showLoading(show) { $("loading-overlay").classList.toggle("hidden", !show); }

function stateLabel(state) {
  const map = { 0: "Offline", 1: "Online", 2: "Busy", 3: "Away", 4: "Snooze", 5: "Looking to trade", 6: "Looking to play" };
  return map[state] ?? "Unknown";
}

function stateClass(state) {
  if (state === 1) return "online";
  if (state === 2 || state === 3 || state === 4) return "away";
  return "offline";
}

// Use Steam's CDN header images (460×215) for a library-accurate look
function gameHeaderUrl(appid) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

// ===== API =====
async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ===== Initialisation — auto-load Steam ID from .env via backend =====
async function init() {
  showLoading(true);
  clearError();
  try {
    const config = await apiFetch("/config");
    if (!config.steam_id) {
      showLoading(false);
      showError("STEAM_ID is not configured. Please set STEAM_ID in the backend .env file.");
      return;
    }
    currentSteamId = config.steam_id;
    await loadProfile();
    // Start loading friends and library in parallel
    loadFriends();
    loadOwnedGames();
    showSection("library");
  } catch (err) {
    showLoading(false);
    showError(`Initialisation failed: ${err.message}`);
  }
}

// ===== Profile =====
async function loadProfile() {
  try {
    const user = await apiFetch(`/user?steam_id=${encodeURIComponent(currentSteamId)}`);
    renderProfile(user);
    showLoading(false);
  } catch (err) {
    showLoading(false);
    showError(`Failed to load profile: ${err.message}`);
    throw err;
  }
}

function renderProfile(user) {
  const cls   = stateClass(user.state);
  const label = stateLabel(user.state);

  // Header bar user info
  $("header-avatar").src = user.avatar || "";
  $("header-username").textContent = user.name || user.steamid;
  $("header-status-dot").className = `dot ${cls}`;
  $("header-user").classList.remove("hidden");

  // Sidebar mini card
  $("sidebar-avatar").src = user.avatar || "";
  $("sidebar-username").textContent = user.name || user.steamid;
  $("sidebar-status-dot").className = `dot ${cls}`;
  $("sidebar-status-text").textContent = label;
  $("sidebar-profile").classList.remove("hidden");
  $("sidebar-nav").classList.remove("hidden");
  $("sidebar-friends-section").classList.remove("hidden");

  // Profile header strip
  $("profile-avatar-full").src = user.avatar || "";
  $("profile-display-name").textContent = user.name || user.steamid;
  const badge = $("profile-status-badge");
  badge.textContent = label;
  badge.className = `profile-status-badge ${cls}`;
  $("profile-country").textContent = user.country ? `📍 ${user.country}` : "";
  $("profile-logoff").textContent = user.last_logoff ? `Last online: ${user.last_logoff}` : "";
  const link = $("profile-url-link");
  if (user.profile_url) { link.href = user.profile_url; link.textContent = user.profile_url; }
  $("profile-header").classList.remove("hidden");
}

// ===== Section switching =====
function showSection(id) {
  document.querySelectorAll(".content-section").forEach(s => s.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const sec = $(`section-${id}`);
  if (sec) sec.classList.remove("hidden");
  const nav = document.querySelector(`.nav-item[data-section="${id}"]`);
  if (nav) nav.classList.add("active");
}

// ===== Friends =====
async function loadFriends() {
  $("sidebar-friends-list").innerHTML = `<p class="msg" style="padding:8px 12px">Loading…</p>`;
  try {
    cachedFriends = await apiFetch(`/friends?steam_id=${encodeURIComponent(currentSteamId)}`);

    // Online badge on nav item
    const onlineCount = cachedFriends.filter(f => f.state > 0).length;
    const countBadge = $("nav-friends-count");
    if (cachedFriends.length) {
      countBadge.textContent = onlineCount > 0 ? `${onlineCount} online` : cachedFriends.length;
      countBadge.classList.remove("hidden");
    }

    renderSidebarFriends(cachedFriends);

    // Re-render full friends view if it's visible
    if (!$("section-friends").classList.contains("hidden")) {
      renderFriendsSection(cachedFriends);
    }
  } catch (err) {
    console.error("Friends load error:", err);
    $("sidebar-friends-list").innerHTML = `<p class="msg msg-error" style="padding:8px 12px">Error loading friends</p>`;
  }
}

function friendsSorted(friends) {
  // Online/Away first, then alphabetical within each group
  return [...friends].sort((a, b) => {
    const ao = a.state > 0 ? 1 : 0, bo = b.state > 0 ? 1 : 0;
    if (ao !== bo) return bo - ao;
    return (a.name || "").localeCompare(b.name || "");
  });
}

function renderSidebarFriends(friends) {
  $("sidebar-friends-list").innerHTML = friendsSorted(friends).map(f => {
    const cls = stateClass(f.state);
    return `
      <div class="sidebar-friend-item">
        <div class="sidebar-friend-avatar-wrap">
          <img src="${f.avatar || ""}" alt="" class="sidebar-friend-avatar" />
          <span class="dot ${cls}"></span>
        </div>
        <div>
          <div class="sidebar-friend-name">${f.name || f.steamid}</div>
          <div class="sidebar-friend-status">${stateLabel(f.state)}</div>
        </div>
      </div>`;
  }).join("");
}

function renderFriendsSection(friends) {
  $("friends-main-list").innerHTML = friends.length
    ? friendsSorted(friends).map(f => {
        const cls = stateClass(f.state);
        return `
          <div class="friend-row">
            <div class="friend-avatar-wrap">
              <img src="${f.avatar || ""}" alt="" class="friend-avatar" />
              <span class="dot ${cls}"></span>
            </div>
            <div class="friend-info">
              <div class="friend-name">${f.name || f.steamid}</div>
              <div class="friend-status ${cls}">${stateLabel(f.state)}</div>
              ${f.country ? `<div class="friend-country">📍 ${f.country}</div>` : ""}
            </div>
            ${f.profile_url ? `<a href="${f.profile_url}" target="_blank" rel="noopener" class="friend-profile-link">View Profile</a>` : ""}
          </div>`;
      }).join("")
    : `<p class="msg">No friends found or profile is private.</p>`;
}

// ===== Owned Games =====
async function loadOwnedGames() {
  $("owned-games-grid").innerHTML = `<p class="msg">Loading library…</p>`;
  try {
    const data = await apiFetch(`/owned-games?steam_id=${encodeURIComponent(currentSteamId)}`);
    $("game-count-label").textContent = `${data.game_count} games`;
    const countBadge = $("nav-game-count");
    countBadge.textContent = data.game_count;
    countBadge.classList.remove("hidden");
    libraryLoaded = true;

    $("owned-games-grid").innerHTML = data.games.length
      ? data.games.map(g => `
          <div class="game-card">
            <img src="${gameHeaderUrl(g.appid)}" alt="${g.name}" class="game-card-img"
                 onerror="this.style.opacity='0.3'" />
            <div class="game-card-body">
              <div class="game-card-name">${g.name}</div>
              <div class="game-card-meta">${g.playtime_forever_hrs} hrs on record</div>
            </div>
          </div>`).join("")
      : `<p class="msg">No games found or library is private.</p>`;
  } catch (err) {
    $("owned-games-grid").innerHTML = `<p class="msg msg-error">Error: ${err.message}</p>`;
  }
}

// ===== Recently Played =====
async function loadRecentlyPlayed() {
  $("recently-played-list").innerHTML = `<p class="msg">Loading…</p>`;
  try {
    const games = await apiFetch(`/recently-played?steam_id=${encodeURIComponent(currentSteamId)}`);
    $("recently-played-list").innerHTML = games.length
      ? games.map(g => `
          <div class="recent-row">
            <img src="${gameHeaderUrl(g.appid)}" alt="${g.name}" class="recent-img"
                 onerror="this.style.display='none'" />
            <div class="recent-info">
              <div class="recent-name">${g.name}</div>
              <div class="recent-playtime">${g.playtime_2weeks_hrs} hrs past 2 weeks</div>
              <div class="recent-playtime">${g.playtime_forever_hrs} hrs on record</div>
            </div>
          </div>`).join("")
      : `<p class="msg">No recently played games.</p>`;
  } catch (err) {
    $("recently-played-list").innerHTML = `<p class="msg msg-error">Error: ${err.message}</p>`;
  }
}

// ===== Game Search =====
async function searchGames() {
  const query = $("game-search-input").value.trim();
  if (!query) return;
  $("search-results").innerHTML = `<p class="msg">Searching…</p>`;
  $("game-details-panel").classList.add("hidden");
  try {
    const results = await apiFetch(`/search-games?query=${encodeURIComponent(query)}`);
    $("search-results").innerHTML = results.length
      ? results.map(g => `
          <div class="game-card">
            <img src="${gameHeaderUrl(g.appid)}" alt="${g.name}" class="game-card-img"
                 onerror="this.style.display='none'" />
            <div class="game-card-body">
              <div class="game-card-name">${g.name}</div>
              <div class="search-card-appid">AppID: ${g.appid}</div>
              <button class="details-btn" data-appid="${g.appid}">View Details</button>
            </div>
          </div>`).join("")
      : `<p class="msg">No games found.</p>`;

    $("search-results").querySelectorAll(".details-btn").forEach(btn => {
      btn.addEventListener("click", () => loadGameDetails(btn.dataset.appid));
    });
  } catch (err) {
    $("search-results").innerHTML = `<p class="msg msg-error">Error: ${err.message}</p>`;
  }
}

async function loadGameDetails(appid) {
  const panel = $("game-details-panel");
  panel.innerHTML = `<div class="gd-body"><p class="msg">Loading details…</p></div>`;
  panel.classList.remove("hidden");
  try {
    const g = await apiFetch(`/game-details?appid=${encodeURIComponent(appid)}`);
    panel.innerHTML = `
      ${g.header_image ? `<img src="${g.header_image}" alt="${g.name}" class="gd-header-img" />` : ""}
      <div class="gd-body">
        <h3 class="gd-title">${g.name}</h3>
        ${g.description ? `<p class="gd-desc">${g.description}</p>` : ""}
        <p class="gd-meta"><strong>Developers:</strong> ${(g.developers || []).join(", ") || "N/A"}</p>
        <p class="gd-meta"><strong>Publishers:</strong> ${(g.publishers || []).join(", ") || "N/A"}</p>
        ${g.genres && g.genres.length ? `<div style="margin-top:6px">${g.genres.map(gn => `<span class="genre-tag">${gn}</span>`).join("")}</div>` : ""}
        ${g.website ? `<p style="margin-top:8px"><a href="${g.website}" target="_blank" rel="noopener" class="gd-link">${g.website}</a></p>` : ""}
      </div>`;
  } catch (err) {
    panel.innerHTML = `<div class="gd-body"><p class="msg msg-error">Error: ${err.message}</p></div>`;
  }
}

// ===== Nav event listeners =====
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    if (!currentSteamId) return;
    const section = item.dataset.section;
    showSection(section);
    if (section === "recently-played") loadRecentlyPlayed();
    else if (section === "friends")    renderFriendsSection(cachedFriends);
    else if (section === "library" && !libraryLoaded) loadOwnedGames();
  });
});

$("game-search-btn").addEventListener("click", searchGames);
$("game-search-input").addEventListener("keydown", e => { if (e.key === "Enter") searchGames(); });

// ===== Boot =====
document.addEventListener("DOMContentLoaded", init);

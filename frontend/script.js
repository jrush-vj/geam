/* ============================================================
   GEAM — Steam Profile Browser  (script.js)
   Auto-fetches default Steam ID from /api/config (backend .env)
   ============================================================ */

const API = "http://127.0.0.1:5000";

/* ---- State ---- */
let currentSteamId = "";
const tabLoaded = {};   // track which tabs have already fetched data

/* ---- DOM refs ---- */
const steamIdInput    = document.getElementById("steam-id-input");
const loadBtn         = document.getElementById("load-btn");
const errorBanner     = document.getElementById("error-banner");
const profileSection  = document.getElementById("profile-section");
const tabsSection     = document.getElementById("tabs-section");

/* ============================================================
   Helpers
   ============================================================ */

const errorText     = document.getElementById("error-text");

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorBanner.textContent = "";
}

function setLoading(container) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div><span>Loading…</span></div>`;
}

function setEmpty(container, msg = "No data available.") {
  container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-info"></i><span>${msg}</span></div>`;
}

/** Map Steam persona state number → CSS class + label */
function stateInfo(state) {
  const map = {
    0: { cls: "",       label: "Offline" },
    1: { cls: "online", label: "Online"  },
    2: { cls: "busy",   label: "Busy"    },
    3: { cls: "away",   label: "Away"    },
    4: { cls: "away",   label: "Snooze"  },
    5: { cls: "online", label: "Looking to Trade" },
    6: { cls: "online", label: "Looking to Play"  },
  };
  return map[state] ?? { cls: "", label: "Offline" };
}

/** Thumbnail URL for a game icon */
function gameIconUrl(appid, iconHash) {
  if (!iconHash) return null;
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${iconHash}.jpg`;
}

/** Header image URL for a game */
function gameHeaderUrl(appid) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

/* ============================================================
   Fetch helpers (O(1) per call, O(n) over n results)
   ============================================================ */

async function apiFetch(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ============================================================
   Boot — auto-load steam_id from /api/config
   ============================================================ */

async function boot() {
  try {
    const cfg = await apiFetch("/api/config");
    if (cfg.steam_id) {
      steamIdInput.value = cfg.steam_id;
    }
  } catch {
    // backend not running yet or no default id — that's fine
  }
}

/* ============================================================
   Profile
   ============================================================ */

async function loadProfile() {
  const steamId = steamIdInput.value.trim();
  if (!steamId) { showError("Please enter a Steam ID."); return; }

  clearError();
  loadBtn.disabled = true;
  loadBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Loading…`;

  try {
    const user = await apiFetch(`/api/user?steam_id=${encodeURIComponent(steamId)}`);
    currentSteamId = steamId;
    renderProfile(user);
    // Reset lazy-load state for the new profile
    Object.keys(tabLoaded).forEach(k => delete tabLoaded[k]);
    // Load the active tab data
    const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
    loadTabData(activeTab);
    profileSection.classList.remove("hidden");
    tabsSection.classList.remove("hidden");
  } catch (e) {
    showError(`Could not load profile: ${e.message}`);
  } finally {
    loadBtn.disabled = false;
    loadBtn.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> Load Profile`;
  }
}

function renderProfile(user) {
  const avatar  = document.getElementById("profile-avatar");
  const name    = document.getElementById("profile-name");
  const url     = document.getElementById("profile-url");
  const country = document.getElementById("profile-country");
  const logoff  = document.getElementById("profile-logoff");
  const stateDot = document.getElementById("profile-state");

  avatar.src = user.avatar || "";
  name.textContent = user.name || "Unknown";

  url.href = user.profile_url || "#";
  url.style.display = user.profile_url ? "" : "none";

  country.innerHTML = user.country
    ? `<i class="fa-solid fa-earth-americas"></i> ${escHtml(user.country)}`
    : "";
  country.style.display = user.country ? "" : "none";

  logoff.innerHTML = user.last_logoff
    ? `<i class="fa-regular fa-clock"></i> Last seen: ${escHtml(user.last_logoff)}`
    : "";
  logoff.style.display = user.last_logoff ? "" : "none";

  const { cls } = stateInfo(user.state);
  stateDot.className = `status-dot ${cls}`.trim();
}

/* ============================================================
   Tab switching
   ============================================================ */

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    const tab = btn.dataset.tab;
    document.getElementById(`tab-${tab}`).classList.add("active");

    if (currentSteamId) loadTabData(tab);
  });
});

function loadTabData(tab) {
  if (!tab || tabLoaded[tab]) return;
  tabLoaded[tab] = true;
  if      (tab === "friends")        loadFriends();
  else if (tab === "recently-played") loadRecentlyPlayed();
  else if (tab === "owned-games")    loadOwnedGames();
}

/* ============================================================
   Friends
   ============================================================ */

async function loadFriends() {
  const container = document.getElementById("friends-list");
  setLoading(container);
  try {
    const friends = await apiFetch(`/api/friends?steam_id=${encodeURIComponent(currentSteamId)}`);
    if (!friends.length) { setEmpty(container, "No friends found (profile may be private)."); return; }

    const frag = document.createDocumentFragment();
    for (const f of friends) {
      const { cls, label } = stateInfo(f.state);
      const card = document.createElement("div");
      card.className = "card friend-card";
      card.innerHTML = `
        <div class="friend-avatar-wrap">
          <img src="${f.avatar || ""}" alt="${escHtml(f.name)}" loading="lazy" />
          <span class="friend-status ${cls}" title="${label}"></span>
        </div>
        <div class="friend-info">
          <div class="friend-name">${escHtml(f.name)}</div>
          <div class="friend-meta">${label}${f.last_logoff && !cls ? ` · ${f.last_logoff}` : ""}</div>
        </div>`;
      frag.appendChild(card);
    }
    container.innerHTML = "";
    container.appendChild(frag);
  } catch (e) {
    setEmpty(container, `Error: ${e.message}`);
  }
}

/* ============================================================
   Recently Played
   ============================================================ */

async function loadRecentlyPlayed() {
  const container = document.getElementById("recently-played-list");
  setLoading(container);
  try {
    const games = await apiFetch(`/api/recently-played?steam_id=${encodeURIComponent(currentSteamId)}`);
    if (!games.length) { setEmpty(container, "No recently played games."); return; }

    const frag = document.createDocumentFragment();
    for (const g of games) {
      frag.appendChild(buildGameCard(g, g.playtime_2weeks_hrs, "2 weeks"));
    }
    container.innerHTML = "";
    container.appendChild(frag);
  } catch (e) {
    setEmpty(container, `Error: ${e.message}`);
  }
}

/* ============================================================
   Owned Games
   ============================================================ */

async function loadOwnedGames() {
  const container = document.getElementById("owned-games-list");
  const countLabel = document.getElementById("owned-count");
  setLoading(container);
  try {
    const data = await apiFetch(`/api/owned-games?steam_id=${encodeURIComponent(currentSteamId)}`);
    const games = data.games || [];
    countLabel.textContent = `${data.game_count ?? games.length} games in library`;

    if (!games.length) { setEmpty(container, "No owned games found (profile may be private)."); return; }

    const frag = document.createDocumentFragment();
    for (const g of games) {
      frag.appendChild(buildGameCard(g, g.playtime_forever_hrs, "total"));
    }
    container.innerHTML = "";
    container.appendChild(frag);
  } catch (e) {
    setEmpty(container, `Error: ${e.message}`);
  }
}

/** Build a game card element (shared by recently-played and owned-games) */
function buildGameCard(g, hrs, hrsLabel) {
  const card = document.createElement("div");
  card.className = "card game-card";
  const imgSrc  = gameHeaderUrl(g.appid);
  const fallback = gameIconUrl(g.appid, g.img_icon_url);

  const imgWrap = document.createElement("div");
  imgWrap.className = "game-img-wrap";

  const img = document.createElement("img");
  img.src     = imgSrc;
  img.alt     = g.name || "";
  img.loading = "lazy";
  if (fallback) img.addEventListener("error", () => { img.src = fallback; }, { once: true });
  imgWrap.appendChild(img);

  const body = document.createElement("div");
  body.className = "game-card-body";
  body.innerHTML = `
    <div class="game-name">${escHtml(g.name)}</div>
    <div class="game-meta"><i class="fa-regular fa-clock"></i> ${hrs} hrs ${hrsLabel}</div>`;

  card.appendChild(imgWrap);
  card.appendChild(body);
  return card;
}

/* ============================================================
   Search Games
   ============================================================ */

document.getElementById("game-search-btn").addEventListener("click", searchGames);
document.getElementById("game-search-input").addEventListener("keydown", e => {
  if (e.key === "Enter") searchGames();
});

async function searchGames() {
  const query = document.getElementById("game-search-input").value.trim();
  if (!query) return;

  const container = document.getElementById("search-results");
  document.getElementById("game-details-panel").classList.add("hidden");
  setLoading(container);

  try {
    const results = await apiFetch(`/api/search-games?query=${encodeURIComponent(query)}`);
    if (!results.length) { setEmpty(container, "No games found."); return; }

    const frag = document.createDocumentFragment();
    for (const g of results) {
      const card = document.createElement("div");
      card.className = "card game-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      const imgSrc = gameHeaderUrl(g.appid);
      card.innerHTML = `
        <div class="game-img-wrap">
          <img src="${imgSrc}" alt="${escHtml(g.name)}" loading="lazy" />
        </div>
        <div class="game-card-body">
          <div class="game-name">${escHtml(g.name)}</div>
          <div class="game-meta"><i class="fa-solid fa-hashtag"></i> ${g.appid}</div>
        </div>`;
      card.addEventListener("click", () => loadGameDetails(g.appid));
      card.addEventListener("keydown", e => { if (e.key === "Enter") loadGameDetails(g.appid); });
      frag.appendChild(card);
    }
    container.innerHTML = "";
    container.appendChild(frag);
  } catch (e) {
    setEmpty(container, `Error: ${e.message}`);
  }
}

/* ============================================================
   Game Details
   ============================================================ */

async function loadGameDetails(appid) {
  const panel = document.getElementById("game-details-panel");
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="loading" style="padding:32px"><div class="spinner"></div><span>Loading…</span></div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

  try {
    const d = await apiFetch(`/api/game-details?appid=${encodeURIComponent(appid)}`);
    const genres = (d.genres || []).map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join("");
    const devs   = (d.developers || []).join(", ");
    const pubs   = (d.publishers || []).join(", ");
    panel.innerHTML = `
      <div class="detail-header">
        ${d.header_image ? `<img src="${escAttr(d.header_image)}" alt="${escAttr(d.name)}" />` : ""}
        <button class="close-btn" id="close-details-btn"><i class="fa-solid fa-xmark"></i> Close</button>
      </div>
      <div class="detail-body">
        <h3>${escHtml(d.name)}</h3>
        <div class="detail-meta">${genres}</div>
        ${devs  ? `<p><strong>Developer:</strong> ${escHtml(devs)}</p>` : ""}
        ${pubs  ? `<p><strong>Publisher:</strong> ${escHtml(pubs)}</p>` : ""}
        ${d.description ? `<p>${escHtml(d.description)}</p>` : ""}
        <a class="detail-link" href="https://store.steampowered.com/app/${appid}/" target="_blank" rel="noopener noreferrer">
          <i class="fa-solid fa-up-right-from-square"></i> View on Steam Store
        </a>
      </div>`;
    document.getElementById("close-details-btn").addEventListener("click", () => {
      panel.classList.add("hidden");
    });
  } catch (e) {
    panel.innerHTML = `<div class="empty-state" style="padding:32px"><i class="fa-solid fa-circle-exclamation"></i><span>Error: ${escHtml(e.message)}</span></div>`;
  }
}

/* ============================================================
   Security: HTML escaping
   ============================================================ */

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(str) { return escHtml(str); }

/* ============================================================
   Wire-up
   ============================================================ */

loadBtn.addEventListener("click", loadProfile);
steamIdInput.addEventListener("keydown", e => { if (e.key === "Enter") loadProfile(); });

// Auto-load the default steam_id from env, then auto-load profile if present
boot().then(() => {
  if (steamIdInput.value.trim()) loadProfile();
});
/* ════════════════════════════════════════════════════════════════
   GEAM — Steam profile browser
   All Steam IDs come from .env via /api/config — no manual input
   ════════════════════════════════════════════════════════════════ */

const API = "http://127.0.0.1:5000";

// ── State ─────────────────────────────────────────────────────────
const loaded = { friends: false, recent: false, library: false };
let currentSteamId = "";
let ownedGamesCache = [];   // kept for O(n) client-side filter

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const steamInput    = $("steam-id-input");
const loadBtn       = $("load-btn");
const errorBanner   = $("error-banner");
const spinner       = $("global-spinner");
const mainLayout    = $("main-layout");
const libraryFilter = $("library-filter");

// ── Startup ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const cfg = await apiFetch("/api/config");
    if (cfg.steam_id) {
      currentSteamId = cfg.steam_id;
      steamInput.value = cfg.steam_id;
      await loadProfile(cfg.steam_id);
    }
  } catch {/* backend not running yet – let user enter manually */ }

  loadBtn.addEventListener("click", async () => {
    const id = steamInput.value.trim();
    if (!id) return showError("Please enter a Steam ID.");
    currentSteamId = id;
    loaded.friends = loaded.recent = loaded.library = false;
    ownedGamesCache = [];
    await loadProfile(id);
  });

  steamInput.addEventListener("keydown", e => e.key === "Enter" && loadBtn.click());

  libraryFilter.addEventListener("input", () => {
    const q = libraryFilter.value.toLowerCase();
    renderGameList(
      "owned-games-list",
      ownedGamesCache.filter(g => g.name.toLowerCase().includes(q))
    );
  });

  $("game-search-btn").addEventListener("click", runGameSearch);
  $("game-search-input").addEventListener("keydown", e => e.key === "Enter" && runGameSearch());

  // Bind all three sets of tab buttons to the same handler
  document.querySelectorAll(".top-nav-btn, .btab, .snav-btn").forEach(btn =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );
});

// ── API helper ────────────────────────────────────────────────────
async function apiFetch(path) {
  const r = await fetch(API + path);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}

// ── Error / Spinner ───────────────────────────────────────────────
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove("hidden");
}
function clearError() { errorBanner.classList.add("hidden"); }
function setLoading(on) { spinner.classList.toggle("hidden", !on); }

// ── Tab switching ─────────────────────────────────────────────────
function switchTab(tab) {
  // Sync all button groups
  document.querySelectorAll(".top-nav-btn, .btab, .snav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  // Show/hide panes
  document.querySelectorAll(".tab-pane").forEach(p => {
    p.classList.toggle("hidden", p.id !== `tab-${tab}`);
    p.classList.toggle("active", p.id === `tab-${tab}`);
  });
  // Lazy-load data for the activated tab
  if (currentSteamId) onTabActivate(tab);
}

async function onTabActivate(tab) {
  if (tab === "friends"         && !loaded.friends) await loadFriends();
  if (tab === "recently-played" && !loaded.recent)  await loadRecentlyPlayed();
  if (tab === "owned-games"     && !loaded.library) await loadOwnedGames();
}

// ── Profile loader ────────────────────────────────────────────────
async function loadProfile(steamId) {
  clearError();
  setLoading(true);
  try {
    const p = await apiFetch(`/api/user?steam_id=${encodeURIComponent(steamId)}`);
    renderProfile(p);
    mainLayout.classList.remove("hidden");
    // Auto-load the default (friends) tab on first load
    loaded.friends = false;
    await loadFriends();
  } catch (e) {
    showError("Could not load profile: " + e.message);
  } finally {
    setLoading(false);
  }
}

function renderProfile(p) {
  const stateLabel = personaStateLabel(p.state);
  const stateClass = personaStateClass(p.state);

  // Sidebar
  $("profile-avatar").src = p.avatar;
  $("profile-name").textContent = p.name;
  $("profile-state").textContent = stateLabel;
  $("profile-state").className = `status-badge ${stateClass}`;
  $("avatar-state-ring").className = `avatar-ring ${stateClass.replace("status-", "")}`;
  $("profile-country").textContent = p.country ? `🌍 ${p.country}` : "";
  $("profile-logoff").textContent = p.last_logoff ? `Last seen: ${p.last_logoff}` : "";
  $("profile-url").href = p.profile_url;

  // Banner
  $("banner-avatar").src = p.avatar;
  $("banner-name").textContent = p.name;
  $("banner-state").textContent = stateLabel;
  $("banner-state").className = `status-badge banner-badge ${stateClass}`;

  // Header username
  $("header-username").textContent = p.name;
}

// ── Friends ───────────────────────────────────────────────────────
async function loadFriends() {
  setLoading(true);
  clearError();
  try {
    const friends = await apiFetch(`/api/friends?steam_id=${encodeURIComponent(currentSteamId)}`);
    loaded.friends = true;
    $("friends-count").textContent = friends.length;
    const ul = $("friends-list");
    ul.innerHTML = "";
    // Sort: online first, then alphabetically — O(N log N)
    friends.sort((a, b) => {
      if (b.state !== a.state) return b.state - a.state;
      return (a.name || "").localeCompare(b.name || "");
    });
    const frag = document.createDocumentFragment();
    friends.forEach(f => {
      const el = document.createElement("div");
      el.className = "friend-row";
      el.innerHTML = `
        <img class="friend-avatar" src="${f.avatar}" alt="" loading="lazy" />
        <div class="friend-info">
          <div class="friend-name">${escHtml(f.name)}</div>
          <div class="friend-status ${personaStateClass(f.state)}">${personaStateLabel(f.state)}</div>
        </div>`;
      frag.appendChild(el);
    });
    ul.appendChild(frag);
  } catch (e) {
    showError("Friends: " + e.message);
  } finally {
    setLoading(false);
  }
}

// ── Recently Played ───────────────────────────────────────────────
async function loadRecentlyPlayed() {
  setLoading(true);
  clearError();
  try {
    const games = await apiFetch(`/api/recently-played?steam_id=${encodeURIComponent(currentSteamId)}`);
    loaded.recent = true;
    renderGameList("recently-played-list", games, g => `${g.playtime_2weeks_hrs} hrs (2 wks)`);
  } catch (e) {
    showError("Recently played: " + e.message);
  } finally {
    setLoading(false);
  }
}

// ── Owned Games ───────────────────────────────────────────────────
async function loadOwnedGames() {
  setLoading(true);
  clearError();
  try {
    const data = await apiFetch(`/api/owned-games?steam_id=${encodeURIComponent(currentSteamId)}`);
    loaded.library = true;
    ownedGamesCache = data.games;
    $("owned-count").textContent = data.game_count;
    renderGameList("owned-games-list", ownedGamesCache, g => `${g.playtime_forever_hrs} hrs`);
  } catch (e) {
    showError("Library: " + e.message);
  } finally {
    setLoading(false);
  }
}

// ── Game list renderer (shared) ───────────────────────────────────
function renderGameList(containerId, games, playtimeFn = g => `${g.playtime_forever_hrs} hrs`) {
  const container = $(containerId);
  container.innerHTML = "";
  if (!games.length) {
    container.innerHTML = `<p style="color:var(--clr-muted);padding:12px">No games found.</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  games.forEach(g => {
    const iconUrl = g.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
      : "https://store.steampowered.com/public/shared/images/header/globalheader_logo.png";
    const row = document.createElement("div");
    row.className = "game-row";
    row.innerHTML = `
      <img class="game-icon" src="${iconUrl}" alt="" loading="lazy" />
      <span class="game-name">${escHtml(g.name)}</span>
      <span class="game-playtime">${playtimeFn(g)}</span>`;
    frag.appendChild(row);
  });
  container.appendChild(frag);
}

// ── Game Search ───────────────────────────────────────────────────
async function runGameSearch() {
  const q = $("game-search-input").value.trim();
  if (!q) return;
  clearError();
  setLoading(true);
  try {
    const results = await apiFetch(`/api/search-games?query=${encodeURIComponent(q)}`);
    const container = $("search-results");
    container.innerHTML = "";
    $("game-details-panel").classList.add("hidden");
    if (!results.length) {
      container.innerHTML = `<p style="color:var(--clr-muted)">No results found.</p>`;
      return;
    }
    const frag = document.createDocumentFragment();
    results.forEach(g => {
      const row = document.createElement("div");
      row.className = "game-row";
      row.innerHTML = `
        <img class="game-icon" src="${g.tiny_image || ''}" alt="" loading="lazy" />
        <span class="game-name">${escHtml(g.name)}</span>
        <span class="game-playtime">App ${g.id}</span>`;
      row.addEventListener("click", () => loadGameDetails(g.id));
      frag.appendChild(row);
    });
    container.appendChild(frag);
  } catch (e) {
    showError("Search: " + e.message);
  } finally {
    setLoading(false);
  }
}

async function loadGameDetails(appid) {
  clearError();
  setLoading(true);
  try {
    const d = await apiFetch(`/api/game-details?appid=${appid}`);
    const panel = $("game-details-panel");
    panel.classList.remove("hidden");
    const genres = (d.genres || []).map(g => `<span class="tag">${escHtml(g)}</span>`).join("");
    const devs = (d.developers || []).join(", ");
    const pubs = (d.publishers || []).join(", ");
    panel.innerHTML = `
      <h3>${escHtml(d.name)}</h3>
      ${d.header_image ? `<img src="${d.header_image}" alt="${escHtml(d.name)}" />` : ""}
      <p>${escHtml(d.description || "")}</p>
      <p><strong style="color:var(--clr-text)">Developer:</strong> ${escHtml(devs)}</p>
      <p><strong style="color:var(--clr-text)">Publisher:</strong> ${escHtml(pubs)}</p>
      <div style="margin-top:8px">${genres}</div>
      ${d.website ? `<p style="margin-top:10px"><a href="${d.website}" target="_blank">Official Website ↗</a></p>` : ""}`;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    showError("Game details: " + e.message);
  } finally {
    setLoading(false);
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function personaStateLabel(state) {
  return ["Offline","Online","Busy","Away","Snooze","Looking to trade","Looking to play"][state] ?? "Offline";
}

function personaStateClass(state) {
  if (state === 1) return "status-online";
  if (state === 3 || state === 4) return "status-away";
  if (state >= 5) return "status-ingame";
  return "status-offline";
}

// XSS-safe text: O(n) one-pass via browser DOM
const _esc = document.createElement("span");
function escHtml(str) {
  _esc.textContent = str ?? "";
  return _esc.innerHTML;
}

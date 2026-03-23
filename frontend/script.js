/* ════════════════════════════════════════════════════════════════
   GEAM — Steam profile browser
   All Steam IDs come from .env via /api/config — no manual input
   ════════════════════════════════════════════════════════════════ */

const API = "http://127.0.0.1:5000";

// ── Quotes ───────────────────────────────────────────────────────
const QUOTES = [
  { q: "War. War never changes.",                                 src: "Fallout" },
  { q: "A man chooses, a slave obeys.",                          src: "BioShock" },
  { q: "The right man in the wrong place can make all the difference in the world.", src: "Half-Life 2" },
  { q: "Nothing is true, everything is permitted.",              src: "Assassin's Creed" },
  { q: "Stay a while and listen.",                               src: "Diablo II" },
  { q: "We all make choices, but in the end, our choices make us.", src: "BioShock" },
  { q: "Death is not the end. But it's not nothing either.",     src: "Hades" },
  { q: "I used to be an adventurer like you. Then I took an arrow in the knee.", src: "The Elder Scrolls V: Skyrim" },
  { q: "You died.",                                              src: "Dark Souls" },
  { q: "The cake is a lie.",                                     src: "Portal" },
  { q: "It's not about how hard you hit. It's about how hard you can get hit and keep moving forward.", src: "The Last of Us Part II" },
  { q: "My word is my bond. And you're already buried.",         src: "Red Dead Redemption 2" },
  { q: "I have mastered time. But it has not mastered me.",      src: "Returnal" },
  { q: "The stars that guide lost sailors are our forebears. And so we are never truly alone.", src: "Final Fantasy XIV" },
  { q: "Hell is empty and all the devils are here.",             src: "God of War" },
];
let _quoteTimer = null;

// ── State ─────────────────────────────────────────────────────────
const loaded = { home: false, friends: false, recent: false, library: false };
let currentSteamId = "";
let ownedGamesCache = [];   // kept for O(n) client-side filter
let selectedLibraryCategory = "all";
const libraryDataCache = {
  all_games: [],
  owned_games: [],
  family_sharing_games: [],
};

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const topbarGameSearch = $("topbar-game-search");
const errorBanner   = $("error-banner");
const spinner       = $("global-spinner");
const mainLayout    = $("main-layout");
const libraryFilter = $("library-filter");
const librarySort   = $("library-sort");
const rightSidebar  = $("right-sidebar");

// ── Startup ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const cfg = await apiFetch("/api/config");
    if (cfg.steam_id) {
      currentSteamId = cfg.steam_id;
      await loadProfile(cfg.steam_id);
    } else {
      showError("No default Steam ID found in backend config.");
    }
  } catch {
    showError("Backend is not reachable. Start backend and refresh.");
  }

  if (libraryFilter) {
    libraryFilter.addEventListener("input", renderSelectedLibrary);
  }
  if (librarySort) {
    librarySort.addEventListener("change", renderSelectedLibrary);
  }
  document.querySelectorAll(".library-category-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedLibraryCategory = btn.dataset.libraryCategory || "all";
      document.querySelectorAll(".library-category-btn").forEach(b => {
        b.classList.toggle("active", b === btn);
      });
      renderSelectedLibrary();
    });
  });

  $('game-search-btn').addEventListener('click', runGameSearch);
  $('game-search-input').addEventListener('keydown', e => e.key === 'Enter' && runGameSearch());
  if (topbarGameSearch) {
    topbarGameSearch.addEventListener("keydown", async e => {
      if (e.key !== "Enter") return;
      const q = topbarGameSearch.value.trim();
      if (!q) return;
      $("game-search-input").value = q;
      switchTab("search");
      await runGameSearch();
    });
  }

  // Left sidebar nav
  document.querySelectorAll(".snav").forEach(btn =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  // Theme toggle
  const themeToggle = $("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const html = document.documentElement;
      const goingLight = html.dataset.theme !== "light";
      html.dataset.theme = goingLight ? "light" : "dark";
      $("icon-moon").classList.toggle("hidden", goingLight);
      $("icon-sun").classList.toggle("hidden",  !goingLight);
    });
  }

  // Right-sidebar data (no Steam ID needed)
  loadFreeGames();
  loadSteamDeals();
  startQuoteRotation();
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
  document.querySelectorAll(".snav").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-pane").forEach(p => {
    p.classList.toggle("hidden", p.id !== `tab-${tab}`);
    p.classList.toggle("active", p.id === `tab-${tab}`);
  });
  if (rightSidebar) {
    rightSidebar.classList.toggle("hidden", tab !== "home");
  }
  if (currentSteamId) onTabActivate(tab);
}

async function onTabActivate(tab) {
  if (tab === "home"            && !loaded.home)    await loadHomeDashboard();
  if (tab === "friends"         && !loaded.friends) await loadFriends();
  if (tab === "owned-games" && (
    !loaded.library ||
    (libraryDataCache.all_games.length === 0 &&
      libraryDataCache.owned_games.length === 0 &&
      libraryDataCache.family_sharing_games.length === 0)
  )) {
    await loadOwnedGames();
  }
}

// ── Profile loader ────────────────────────────────────────────────
async function loadProfile(steamId) {
  clearError();
  setLoading(true);
  try {
    const p = await apiFetch(`/api/user?steam_id=${encodeURIComponent(steamId)}`);
    renderProfile(p);
    // Hide pre-load hint, show main layout
    const preLoad = $("pre-load");
    if (preLoad) preLoad.classList.add("hidden");
    mainLayout.classList.remove("hidden");
    switchTab("home");
    await loadHomeDashboard();
  } catch (e) {
    showError("Could not load profile: " + e.message);
  } finally {
    setLoading(false);
  }
}

function renderProfile(p) {
  const stateLabel = personaStateLabel(p.state);

  // Left sidebar
  $('profile-avatar').src = p.avatar;
  $('profile-name').textContent = p.name;
  $('profile-state').textContent = stateLabel;
  $('profile-url').href = p.profile_url;

  // Topbar
  $('header-username').textContent = p.name;

  // Hero greeting
  const heroEl = $('hero-username');
  if (heroEl) heroEl.textContent = p.name;

  // Hero background – show avatar as fallback (replaced by game art later)
  const heroBg = $('hero-bg');
  if (heroBg && p.avatar) {
    heroBg.style.backgroundImage = `url('${p.avatar}')`;
    heroBg.classList.add('loaded');
  }
}

// ── Home Dashboard ───────────────────────────────────────────────
async function loadHomeDashboard() {
  loaded.home = true;

  // Run all three data fetches in parallel for speed
  const [recentRes, ownedRes, friendsRes] = await Promise.allSettled([
    apiFetch(`/api/recently-played?steam_id=${encodeURIComponent(currentSteamId)}`),
    apiFetch(`/api/owned-games?steam_id=${encodeURIComponent(currentSteamId)}`),
    apiFetch(`/api/friends?steam_id=${encodeURIComponent(currentSteamId)}`),
  ]);

  // Recently played
  if (recentRes.status === "fulfilled") {
    const games = recentRes.value;
    loaded.recent = true;
    $("stat-recent").textContent = games.length;
    renderCoversGrid(games);
    // Use first game's header art as hero background
    if (games.length) {
      const heroBg = $("hero-bg");
      const imgUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${games[0].appid}/header.jpg`;
      const img = new Image();
      img.onload = () => {
        heroBg.style.backgroundImage = `url('${imgUrl}')`;
        heroBg.classList.add("loaded");
      };
      img.src = imgUrl;
    }
  }

  // Owned games → played + backlog + library
  if (ownedRes.status === "fulfilled") {
    const data = ownedRes.value;
    ownedGamesCache = data.games;
    const total  = data.game_count || data.games.length;
    const played = data.games.filter(g => g.playtime_forever_hrs > 0).length;
    const backlog = total - played;
    $("stat-played").textContent  = fmtK(played);
    $("stat-backlog").textContent = fmtK(backlog);
    $("stat-library").textContent = fmtK(total);
    $("owned-count").textContent  = total;
  }

  // Friends online
  if (friendsRes.status === "fulfilled") {
    const friends = friendsRes.value;
    loaded.friends = true;
    const online = friends.filter(f => f.state === 1).length;
    $("stat-friends").textContent = online;
    $("friends-count").textContent = friends.length;
    // Re-render friends list so the tab is ready
    const ul = $("friends-list");
    ul.innerHTML = "";
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
  }
}

function renderCoversGrid(games) {
  const grid = $("home-covers-grid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!games.length) {
    grid.innerHTML = `<p style="color:var(--clr-muted);padding:4px 0">No recently played games.</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  games.forEach(g => {
    const imgUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`;
    const card = document.createElement("div");
    card.className = "cover-card";
    card.innerHTML = `
      <img src="${imgUrl}" alt="" loading="lazy"
           onerror="this.src='https://store.steampowered.com/public/shared/images/header/globalheader_logo.png'" />
      <div class="cover-label">${escHtml(g.name)}</div>`;
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

function fmtK(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// ── Quote Rotation ────────────────────────────────────────────────
function startQuoteRotation() {
  const quoteEl  = $("hero-quote");
  const sourceEl = $("hero-quote-source");
  if (!quoteEl || !sourceEl) return;

  let idx = Math.floor(Math.random() * QUOTES.length);

  function showQuote() {
    const { q, src } = QUOTES[idx % QUOTES.length];
    quoteEl.classList.add("fade");
    setTimeout(() => {
      quoteEl.textContent   = `"${q}"`;
      sourceEl.textContent  = `— ${src}`;
      quoteEl.classList.remove("fade");
      idx++;
    }, 450);
  }

  showQuote();
  if (_quoteTimer) clearInterval(_quoteTimer);
  _quoteTimer = setInterval(showQuote, 8000);
}

// ── Steam Deals ───────────────────────────────────────────────────
async function loadSteamDeals() {
  const container = $("steam-deals-list");
  if (!container) return;
  try {
    const deals = await apiFetch("/api/steam-deals");
    renderSteamDeals(deals, container);
  } catch {
    container.innerHTML = `<div class="rs-error">Could not load deals.</div>`;
  }
}

function renderSteamDeals(deals, container) {
  container.innerHTML = "";
  if (!deals.length) {
    container.innerHTML = `<div class="rs-placeholder">No deals right now.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  deals.forEach(d => {
    const a = document.createElement("a");
    a.className = "rs-game-card";
    a.href = d.url || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `
      <img class="rs-thumb" src="${escHtml(d.thumbnail || '')}" alt=""
           onerror="this.style.display='none'" loading="lazy" />
      <div class="rs-game-info">
        <div class="rs-game-title">${escHtml(d.title)}</div>
        <span class="rs-badge-deal">-${escHtml(String(d.discount))}%</span>
        <span class="rs-price-orig">${escHtml(d.original_price || '')}</span>
      </div>`;
    frag.appendChild(a);
  });
  container.appendChild(frag);
}

// ── Free Games ────────────────────────────────────────────────────
async function loadFreeGames() {
  const container = $("free-games-list");
  if (!container) return;
  try {
    const games = await apiFetch("/api/free-games");
    renderFreeGames(games, container);
  } catch {
    container.innerHTML = `<div class="rs-error">Could not load free games.</div>`;
  }
}

function renderFreeGames(games, container) {
  container.innerHTML = "";
  if (!games.length) {
    container.innerHTML = `<div class="rs-placeholder">No free promotions right now.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  games.forEach(g => {
    const a = document.createElement("a");
    a.className = "rs-game-card";
    a.href = g.url || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `
      <img class="rs-thumb" src="${escHtml(g.thumbnail || '')}" alt=""
           onerror="this.style.display='none'" loading="lazy" />
      <div class="rs-game-info">
        <div class="rs-game-title">${escHtml(g.title)}</div>
        <span class="rs-badge-free">FREE</span>
      </div>`;
    frag.appendChild(a);
  });
  container.appendChild(frag);
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
    const data = await apiFetch(`/api/library-catalog?steam_id=${encodeURIComponent(currentSteamId)}`);
    loaded.library = true;
    libraryDataCache.all_games = data.all_games || [];
    libraryDataCache.owned_games = data.owned_games || [];
    libraryDataCache.family_sharing_games = data.family_sharing_games || [];
    ownedGamesCache = libraryDataCache.owned_games;
    renderSelectedLibrary();
  } catch (e) {
    showError("Library: " + e.message);
  } finally {
    setLoading(false);
  }
}

function getSelectedLibraryKey() {
  const v = selectedLibraryCategory || "all";
  if (v === "owned") return "owned_games";
  if (v === "family") return "family_sharing_games";
  return "all_games";
}

function renderSelectedLibrary() {
  const key = getSelectedLibraryKey();
  const q = (libraryFilter?.value || "").toLowerCase().trim();
  const list = libraryDataCache[key] || [];
  const filtered = q ? list.filter(g => (g.name || "").toLowerCase().includes(q)) : list;

  const sortMode = librarySort?.value || "alphabetical";
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "playtime") {
      return (b.playtime_forever_hrs || 0) - (a.playtime_forever_hrs || 0);
    }
    return (a.name || "").localeCompare(b.name || "");
  });

  $("owned-count").textContent = sorted.length;
  renderLibraryRail(sorted);
  renderLibraryGrid(
    "owned-games-list",
    sorted,
    g => g.source === "family_share" ? "Family Share" : `${g.playtime_forever_hrs} hrs`
  );
}

function renderLibraryRail(games) {
  const container = $("library-side-list");
  if (!container) return;
  container.innerHTML = "";
  if (!games.length) {
    container.innerHTML = `<div class="library-empty">No games match the current filter.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  games.slice(0, 40).forEach(g => {
    const item = document.createElement("div");
    item.className = "library-side-item";
    const iconUrl = g.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
      : "https://store.steampowered.com/public/shared/images/header/globalheader_logo.png";
    item.innerHTML = `
      <img class="library-side-icon" src="${iconUrl}" alt="" loading="lazy" />
      <div class="library-side-meta">
        <div class="library-side-name">${escHtml(g.name)}</div>
        <div class="library-side-subtitle">${g.source === "family_share" ? "Family Share" : `${g.playtime_forever_hrs} hrs played`}</div>
      </div>`;
    frag.appendChild(item);
  });
  container.appendChild(frag);
}

function renderLibraryGrid(containerId, games, playtimeFn = g => `${g.playtime_forever_hrs} hrs`) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = "";
  if (!games.length) {
    container.innerHTML = `<div class="library-empty">No games found.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  games.forEach(g => {
    const card = document.createElement("div");
    card.className = "library-card";
    const coverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`;
    const fallbackUrl = g.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
      : "https://store.steampowered.com/public/shared/images/header/globalheader_logo.png";
    card.innerHTML = `
      <img src="${coverUrl}" alt="" loading="lazy" onerror="this.src='${fallbackUrl}'" />
      <div class="library-card-overlay">
        <div class="library-card-title">${escHtml(g.name)}</div>
        <div class="library-card-meta">
          <span class="library-card-badge ${g.source === "family_share" ? "family" : ""}">${g.source === "family_share" ? "Family Share" : "Owned"}</span>
          <span class="library-card-playtime">${escHtml(playtimeFn(g))}</span>
        </div>
      </div>`;
    frag.appendChild(card);
  });
  container.appendChild(frag);
}

// ── Legacy row renderer ──────────────────────────────────────────
function renderGameList(containerId, games, playtimeFn = g => `${g.playtime_forever_hrs} hrs`) {
  const container = $(containerId);
  if (!container) return;
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

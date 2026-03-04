const API = "http://127.0.0.1:8000";

async function loadUser() {
    const res = await fetch(`${API}/user`);
    const data = await res.json();
    document.getElementById("output").innerHTML =
        `<h3>${data.personaname}</h3>
         <p>Country: ${data.loccountrycode}</p>
         <p>Status: ${data.personastate}</p>`;
}

async function loadOwned() {
    const res = await fetch(`${API}/owned`);
    const data = await res.json();
    let html = "<h3>Owned Games</h3>";
    data.forEach(g => {
        html += `<p>${g.name} - ${(g.playtime_forever/60).toFixed(2)} hrs</p>`;
    });
    document.getElementById("output").innerHTML = html;
}

async function loadRecent() {
    const res = await fetch(`${API}/recent`);
    const data = await res.json();
    let html = "<h3>Recent Games</h3>";
    data.forEach(g => {
        html += `<p>${g.name} - ${(g.playtime_2weeks/60).toFixed(2)} hrs</p>`;
    });
    document.getElementById("output").innerHTML = html;
}

async function searchGame() {
    const query = document.getElementById("searchBox").value;
    const res = await fetch(`${API}/search/${query}`);
    const data = await res.json();
    let html = "<h3>Search Results</h3>";
    data.forEach(g => {
        html += `<p>${g.name} (AppID: ${g.appid})</p>`;
    });
    document.getElementById("output").innerHTML = html;
}
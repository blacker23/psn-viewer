let authData = null;

const profileEl = document.getElementById("profile");
const gamesEl = document.getElementById("games");

document.getElementById("load").onclick = async () => {
  const npsso = document.getElementById("npsso").value.trim();

  if (!npsso) {
    alert("Insert NPSSO");
    return;
  }

  profileEl.innerHTML = '<div class="card">Loading...</div>';
  gamesEl.innerHTML = "";

  const resp = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ npsso })
  });

  const data = await resp.json();

  if (!data.ok) {
    profileEl.innerHTML = "";
    alert(data.error || "Login error");
    return;
  }

  authData = data.authorization;
  renderDashboard(data);
};

function renderDashboard(data) {
  const me = data.me || {};
  const summary = data.trophySummary || {};
  const presence = data.presence || {};
  const titles = data.titles || [];
  const playedGames = data.playedGames || [];
  const recentlyPlayed = data.recentlyPlayed || [];
  const purchasedGames = data.purchasedGames || [];
  const friends = data.friends?.profiles || [];

  profileEl.innerHTML = `
    <div class="grid">
      <div class="card">
        <h3>Profile</h3>
        ${me.avatarUrl ? `<img src="${escapeHtml(me.avatarUrl)}" alt="avatar" width="80" style="border-radius:50%; margin-bottom:12px;">` : ""}
        <div><b>Online ID:</b> ${escapeHtml(me.onlineId || "-")}</div>
        <div><b>Account ID:</b> ${escapeHtml(me.accountId || "-")}</div>
        <div><b>About:</b> ${escapeHtml(me.aboutMe || "-")}</div>
        <div><b>Languages:</b> ${escapeHtml((me.languages || []).join(", ") || "-")}</div>
        <div><b>PS Plus:</b> ${me.isPlus ? "Yes" : "No"}</div>
        <div><b>Verified:</b> ${me.isOfficiallyVerified ? "Yes" : "No"}</div>
        <div><b>Share URL:</b> ${
          me.shareUrl
            ? `<a href="${escapeHtml(me.shareUrl)}" target="_blank">Open profile</a>`
            : "-"
        }</div>
      </div>

      <div class="card">
        <h3>Trophy Summary</h3>
        <div><b>Level:</b> ${escapeHtml(summary.trophyLevel || "-")}</div>
        <div><b>Progress:</b> ${escapeHtml(summary.progress ?? "-")}</div>
        <div><b>Tier:</b> ${escapeHtml(summary.tier ?? "-")}</div>
        <div><b>Bronze:</b> ${escapeHtml(summary.earnedTrophies?.bronze ?? 0)}</div>
        <div><b>Silver:</b> ${escapeHtml(summary.earnedTrophies?.silver ?? 0)}</div>
        <div><b>Gold:</b> ${escapeHtml(summary.earnedTrophies?.gold ?? 0)}</div>
        <div><b>Platinum:</b> ${escapeHtml(summary.earnedTrophies?.platinum ?? 0)}</div>
      </div>
    </div>

    <div class="card">
      <h3>Presence</h3>
      <div><b>Status:</b> ${escapeHtml(presence.onlineStatus || "-")}</div>
      <div><b>Availability:</b> ${escapeHtml(presence.availability || "-")}</div>
      <div><b>Platform:</b> ${escapeHtml(presence.platform || presence.primaryPlatformInfo?.platform || "-")}</div>
      <div><b>Last online:</b> ${escapeHtml(presence.lastOnlineDate || presence.primaryPlatformInfo?.lastOnlineDate || "-")}</div>
      <div><b>Current game:</b> ${escapeHtml(
        presence.gameTitleInfoList?.map((g) => g.titleName).join(", ") || "-"
      )}</div>
    </div>
  `;

  gamesEl.innerHTML = `
    ${renderGameButtons("Trophy Titles", titles, true)}
    ${renderSimpleGames("Recently Played", recentlyPlayed)}
    ${renderSimpleGames("Played Games", playedGames)}
    ${renderSimpleGames("Purchased Games", purchasedGames)}
    ${renderFriends("Friends", friends)}
    <div id="trophiesBox"></div>
  `;

  attachTitleButtonEvents(titles);
}

function renderGameButtons(title, items, clickable = false) {
  if (!items.length) {
    return `<div class="card"><h3>${escapeHtml(title)}</h3><div>No data</div></div>`;
  }

  const rows = items.map((item, idx) => {
    const gameName = item.trophyTitleName || item.name || item.titleName || "Unknown title";
    const platform = item.trophyTitlePlatform || item.platform || item.category || "-";
    const progress = item.progress ?? item.titleProgress ?? "";

    if (clickable) {
      return `
        <button class="title-btn" data-index="${idx}">
          ${escapeHtml(gameName)}
          ${platform ? `[${escapeHtml(platform)}]` : ""}
          ${progress !== "" ? ` - ${escapeHtml(String(progress))}%` : ""}
        </button>
      `;
    }

    return `<div>${escapeHtml(gameName)}</div>`;
  }).join("");

  return `<div class="card"><h3>${escapeHtml(title)}</h3>${rows}</div>`;
}

function renderSimpleGames(title, items) {
  if (!items.length) {
    return `<div class="card"><h3>${escapeHtml(title)}</h3><div>No data</div></div>`;
  }

  const rows = items.map((item) => {
    const gameName =
      item.name ||
      item.titleName ||
      item.trophyTitleName ||
      item.conceptName ||
      "Unknown title";

    const platform =
      item.platform ||
      item.category ||
      item.trophyTitlePlatform ||
      item.playPlatform ||
      "-";

    const image =
      item.imageUrl ||
      item.conceptIconUrl ||
      item.coverArtUrl ||
      item.npTitleIconUrl ||
      "";

    return `
      <div class="game-row">
        ${image ? `<img src="${escapeHtml(image)}" alt="" width="48">` : ""}
        <div>
          <div><b>${escapeHtml(gameName)}</b></div>
          <div>${escapeHtml(String(platform))}</div>
        </div>
      </div>
    `;
  }).join("");

  return `<div class="card"><h3>${escapeHtml(title)}</h3>${rows}</div>`;
}

function renderFriends(title, friends) {
  if (!friends.length) {
    return `<div class="card"><h3>${escapeHtml(title)}</h3><div>No data</div></div>`;
  }

  const rows = friends.map((f) => `
    <div class="friend-row">
      ${f.avatarUrl ? `<img src="${escapeHtml(f.avatarUrl)}" alt="" width="42" style="border-radius:50%;">` : ""}
      <div>
        <div><b>${escapeHtml(f.onlineId || "Unknown")}</b></div>
        <div>${escapeHtml(f.aboutMe || "")}</div>
      </div>
    </div>
  `).join("");

  return `<div class="card"><h3>${escapeHtml(title)}</h3>${rows}</div>`;
}

function attachTitleButtonEvents(titles) {
  document.querySelectorAll(".title-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const title = titles[idx];
      await loadGame(title);
    });
  });
}

async function loadGame(title) {
  const trophiesBox = document.getElementById("trophiesBox");
  trophiesBox.innerHTML = '<div class="card"><h3>Loading trophies...</h3></div>';

  const resp = await fetch("/api/title", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authorization: authData,
      npCommunicationId: title.npCommunicationId,
      platform: title.trophyTitlePlatform
    })
  });

  const data = await resp.json();

  if (!data.ok) {
    trophiesBox.innerHTML = `<div class="card" style="color:red;">${escapeHtml(data.error || "Failed to load trophies")}</div>`;
    return;
  }

  const trophies = data.trophies || [];

  trophiesBox.innerHTML = `
    <div class="card">
      <h3>${escapeHtml(title.trophyTitleName || "Trophies")}</h3>
      ${trophies.map((t) => `
        <div class="trophy-row">
          ${t.trophyIconUrl ? `<img src="${escapeHtml(t.trophyIconUrl)}" alt="" width="48">` : ""}
          <div>
            <div>
              ${t.earned ? "✅" : "⬜"}
              <b>${escapeHtml(t.trophyName || "Unnamed trophy")}</b>
              (${escapeHtml(t.trophyType || "-")})
            </div>
            <div>${escapeHtml(t.trophyDetail || "")}</div>
            <div>Rarity: ${escapeHtml(String(t.trophyRare ?? "-"))}</div>
            <div>Earned rate: ${escapeHtml(String(t.trophyEarnedRate ?? "-"))}</div>
            <div>Earned at: ${escapeHtml(t.earnedDateTime || "-")}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

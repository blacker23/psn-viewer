const contentEl = document.getElementById("content");

document.getElementById("load").onclick = async () => {
  const npsso = document.getElementById("npsso").value.trim();

  if (!npsso) {
    alert("Insert NPSSO");
    return;
  }

  contentEl.innerHTML = '<div class="card">Loading...</div>';

  const resp = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ npsso })
  });

  const data = await resp.json();

  if (!data.ok) {
    contentEl.innerHTML = "";
    alert(data.error || "Login error");
    return;
  }

  renderDashboard(data);
};

function renderDashboard(data) {
  const me = data.me || {};
  const summary = data.trophySummary || {};
  const presence = data.presence || {};
  const recentlyPlayed = data.recentlyPlayed || [];
  const playedGames = data.playedGames || [];
  const purchasedGames = data.purchasedGames || [];

  const deviceList =
    data.devices?.accountDevices ||
    data.devices?.devices ||
    data.devices?.activatedDevices ||
    [];

  const blockedList =
    data.blocked?.blockedUsers ||
    data.blocked?.accountIds ||
    data.blocked?.users ||
    data.blocked?.blocks ||
    data.blocked?.blockedAccountIds ||
    [];

  const friendRequestsList =
    data.friendRequests?.friendRequests ||
    data.friendRequests?.accountIds ||
    data.friendRequests?.requests ||
    data.friendRequests?.users ||
    [];

  contentEl.innerHTML = `
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
          me.shareUrl ? `<a href="${escapeHtml(me.shareUrl)}" target="_blank">Open profile</a>` : "-"
        }</div>
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

    ${renderSimpleGames("Recently Played", recentlyPlayed)}
    ${renderSimpleGames("Played Games", playedGames)}
    ${renderSimpleGames("Purchased Games", purchasedGames)}
    ${renderDevices("Devices", deviceList, data.devices)}
    ${renderIdList("Blocked Users", blockedList, data.blocked)}
    ${renderIdList("Friend Requests", friendRequestsList, data.friendRequests)}
  `;
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
      <div class="row">
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

function renderDevices(title, items, raw) {
  if (!items.length) {
    return `
      <div class="card">
        <h3>${escapeHtml(title)}</h3>
        <div>No data</div>
        ${raw?.error ? `<div style="color:red; margin-top:8px;">${escapeHtml(raw.error)}</div>` : ""}
      </div>
    `;
  }

  const rows = items.map((item) => {
    const type =
      item.deviceType ||
      item.platform ||
      item.model ||
      item.type ||
      item.name ||
      "Unknown device";

    const deviceId =
      item.deviceId ||
      item.id ||
      item.serialNumber ||
      item.systemId ||
      "-";

    const activatedAt =
      item.activationDate ||
      item.activatedAt ||
      item.activationTime ||
      item.createdDateTime ||
      item.registrationDate ||
      "-";

    const extra = Object.entries(item || {})
      .slice(0, 8)
      .map(([k, v]) => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(stringifyValue(v))}</div>`)
      .join("");

    return `
      <div class="row">
        <div>
          <div><b>${escapeHtml(type)}</b></div>
          <div><b>Device ID:</b> ${escapeHtml(deviceId)}</div>
          <div><b>Activation date:</b> ${escapeHtml(activatedAt)}</div>
          ${extra}
        </div>
      </div>
    `;
  }).join("");

  return `<div class="card"><h3>${escapeHtml(title)}</h3>${rows}</div>`;
}

function renderIdList(title, items, raw) {
  if (!items.length) {
    return `
      <div class="card">
        <h3>${escapeHtml(title)}</h3>
        <div>No data</div>
        ${raw?.error ? `<div style="color:red; margin-top:8px;">${escapeHtml(raw.error)}</div>` : ""}
      </div>
    `;
  }

  const rows = items.map((item) => {
    const value =
      typeof item === "object"
        ? stringifyValue(item)
        : String(item);

    return `<div class="row"><div>${escapeHtml(value)}</div></div>`;
  }).join("");

  return `<div class="card"><h3>${escapeHtml(title)}</h3>${rows}</div>`;
}

function stringifyValue(v) {
  if (v == null) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

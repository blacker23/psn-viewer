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

document.getElementById("logoutAll").onclick = async () => {
  const npsso = document.getElementById("npsso").value.trim();

  if (!npsso) {
    alert("Сначала вставьте NPSSO");
    return;
  }

  if (!confirm("⚠️ Это действие завершит все активные сессии на всех устройствах (PS4, PS5, мобильное приложение, веб). Продолжить?")) {
    return;
  }

  const btn = document.getElementById("logoutAll");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Выход...";

  try {
    const resp = await fetch("/api/logout-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npsso })
    });

    const data = await resp.json();

    if (data.ok) {
      alert(`✅ ${data.message}\nСессий завершено: ${data.devicesCount || 'N/A'}`);
      document.getElementById("npsso").value = "";
      if (contentEl.innerHTML !== '') {
        contentEl.innerHTML = '<div class="card">Сессии сброшены. Вставьте новый NPSSO для продолжения.</div>';
      }
    } else {
      alert(`❌ Ошибка: ${data.error || 'Неизвестная ошибка'}`);
    }
  } catch (error) {
    alert(`❌ Ошибка сети: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

function renderDashboard(data) {
  const p = data.profile || {};
  const devices = data.devices || [];
  const purchasedGames = data.purchasedGames || [];
  const s = data.currentSession || {};

  contentEl.innerHTML = `
    <div class="card">
      <h3>Профиль</h3>
      ${p.avatarUrl ? `<img src="${escapeHtml(p.avatarUrl)}" alt="avatar" width="80" style="border-radius:50%; margin-bottom:12px;">` : ""}
      <div><b>Online ID:</b> ${escapeHtml(p.onlineId || "-")}</div>
      <div><b>Account ID:</b> ${escapeHtml(p.accountId || "-")}</div>
      <div><b>Languages:</b> ${escapeHtml((p.languages || []).join(", ") || "-")}</div>
      <div><b>PS Plus:</b> ${p.isPlus ? "Yes" : "No"}</div>
      <div><b>Имя:</b> ${escapeHtml(p.firstName || "-")}</div>
      <div><b>Фамилия:</b> ${escapeHtml(p.lastName || "-")}</div>
      <div><b>About Me:</b> ${escapeHtml(p.aboutMe || "-")}</div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Активированные устройства</h3>
        ${
          devices.length
            ? devices.map((d) => `
                <div class="row">
                  <div>
                    <div><b>Устройство:</b> ${escapeHtml(d.deviceType || "-")}</div>
                    <div><b>ID:</b> ${escapeHtml(d.deviceId || "-")}</div>
                    <div><b>Дата активации:</b> ${escapeHtml(d.activationDate || "-")}</div>
                  </div>
                </div>
              `).join("")
            : "<div>No data</div>"
        }
      </div>

      <div class="card">
        <h3>Текущие сессии</h3>
        <div><b>Status:</b> ${escapeHtml(s.onlineStatus || "-")}</div>
        <div><b>Availability:</b> ${escapeHtml(s.availability || "-")}</div>
        <div><b>Platform:</b> ${escapeHtml(s.platform || "-")}</div>
        <div><b>Last online:</b> ${escapeHtml(s.lastOnlineDate || "-")}</div>
        <div style="margin-top:10px;"><b>Current game(s):</b></div>
        ${
          (s.currentGames || []).length
            ? s.currentGames.map((g) => `
                <div class="row">
                  <div>
                    <div><b>${escapeHtml(g.titleName || "-")}</b></div>
                    <div>${escapeHtml(g.format || g.launchPlatform || "-")}</div>
                  </div>
                </div>
              `).join("")
            : "<div>-</div>"
        }
      </div>
    </div>

    <div class="card">
      <h3>Купленные игры</h3>
      ${
        purchasedGames.length
          ? purchasedGames.map((g) => `
              <div class="row">
                ${g.imageUrl ? `<img src="${escapeHtml(g.imageUrl)}" alt="" width="48">` : ""}
                <div>
                  <div><b>${escapeHtml(g.title || "-")}</b></div>
                  <div><b>Платформа:</b> ${escapeHtml(g.platform || "-")}</div>
                  <div><b>Дата покупки:</b> ${escapeHtml(g.purchaseDate || "-")}</div>
                </div>
              </div>
            `).join("")
          : "<div>No data</div>"
      }
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

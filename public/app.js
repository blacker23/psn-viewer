const contentEl = document.getElementById("content");
const debugOutput = document.getElementById("debugOutput");

// Функция для добавления сообщения в отладчик
function addDebugMessage(step, message, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  const className = isError ? 'error' : 'success';
  debugOutput.innerHTML += `\n[${timestamp}] <span class="${className}">${step}:</span> ${message}\n`;
  debugOutput.scrollTop = debugOutput.scrollHeight;
}

function clearDebug() {
  debugOutput.innerHTML = 'Очищено. Нажмите кнопку для выполнения шага...';
}

// ============================================
// ОБНОВЛЕННЫЕ ФУНКЦИИ ОТЛАДКИ (через сервер)
// ============================================

async function step1_getCamToken() {
  const npsso = document.getElementById("npsso").value.trim();
  if (!npsso) { alert("NPSSO required"); return; }

  addDebugMessage("ШАГ 1", "Запрос CAM token через сервер...");
  
  try {
    const response = await fetch("/api/debug/step1-cam-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npsso })
    });

    const data = await response.json();
    
    addDebugMessage("ШАГ 1", `Статус: ${data.status || 'OK'}`);
    
    if (data.success) {
      addDebugMessage("ШАГ 1", `✅ CAM Token получен!`);
      addDebugMessage("ШАГ 1", `Token: ${data.token.substring(0, 30)}...`);
      localStorage.setItem('camToken', data.token);
    } else {
      addDebugMessage("ШАГ 1", `❌ Ошибка: ${data.error || 'Неизвестная ошибка'}`, true);
      if (data.body) {
        addDebugMessage("ШАГ 1", `Ответ: ${data.body}`, true);
      }
    }
  } catch (e) {
    addDebugMessage("ШАГ 1", `❌ Ошибка: ${e.message}`, true);
  }
}

async function step2_getAccountUuid() {
  const npsso = document.getElementById("npsso").value.trim();
  if (!npsso) { alert("NPSSO required"); return; }

  addDebugMessage("ШАГ 2", "Запрос accountUuid через сервер...");
  
  try {
    const response = await fetch("/api/debug/step2-account-uuid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npsso })
    });

    const data = await response.json();
    
    if (data.success) {
      addDebugMessage("ШАГ 2", `✅ accountUuid: ${data.accountUuid}`);
      localStorage.setItem('accountUuid', data.accountUuid);
    } else {
      addDebugMessage("ШАГ 2", `❌ Ошибка на шаге: ${data.step || 'unknown'}`, true);
      if (data.error) {
        addDebugMessage("ШАГ 2", `Детали: ${data.error}`, true);
      }
    }
  } catch (e) {
    addDebugMessage("ШАГ 2", `❌ Ошибка: ${e.message}`, true);
  }
}

async function step3_getClients() {
  const npsso = document.getElementById("npsso").value.trim();
  if (!npsso) { alert("NPSSO required"); return; }

  addDebugMessage("ШАГ 3", "Запрос списка устройств через сервер...");
  
  try {
    const response = await fetch("/api/debug/step3-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npsso })
    });

    const data = await response.json();
    
    if (data.success) {
      addDebugMessage("ШАГ 3", `✅ Найдено устройств: ${data.count}`);
      data.clients.forEach((client, i) => {
        addDebugMessage("ШАГ 3", `  ${i+1}. ${client.type || 'Unknown'} - Последний онлайн: ${client.lastOnlineDate || 'неизвестно'}`);
      });
    } else {
      addDebugMessage("ШАГ 3", `❌ Ошибка: ${data.error || 'Неизвестная ошибка'}`, true);
    }
  } catch (e) {
    addDebugMessage("ШАГ 3", `❌ Ошибка: ${e.message}`, true);
  }
}

async function step4_deleteSessions() {
  const camToken = localStorage.getItem('camToken');
  const accountUuid = localStorage.getItem('accountUuid');
  
  if (!camToken || !accountUuid) {
    addDebugMessage("ШАГ 4", "❌ Нет CAM token или accountUuid. Сначала выполните шаги 1 и 2", true);
    return;
  }

  addDebugMessage("ШАГ 4", "Отправка DELETE запроса через сервер...");

  try {
    const response = await fetch("/api/debug/step4-logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ camToken, accountUuid })
    });

    const data = await response.json();
    
    addDebugMessage("ШАГ 4", `Статус: ${data.status}`);
    addDebugMessage("ШАГ 4", `Ответ: ${data.response}`);

    if (data.success) {
      addDebugMessage("ШАГ 4", "✅ Выход выполнен успешно!");
      document.getElementById("npsso").value = "";
      localStorage.clear();
    } else {
      addDebugMessage("ШАГ 4", "❌ Ошибка при выходе", true);
    }
  } catch (e) {
    addDebugMessage("ШАГ 4", `❌ Ошибка: ${e.message}`, true);
  }
}
// ============================================
// Назначение обработчиков
// ============================================
document.getElementById("step1Btn").onclick = step1_getCamToken;
document.getElementById("step2Btn").onclick = step2_getAccountUuid;
document.getElementById("step3Btn").onclick = step3_getClients;
document.getElementById("step4Btn").onclick = step4_deleteSessions;
document.getElementById("clearDebugBtn").onclick = clearDebug;

// Остальной ваш код (load, logoutAll, renderDashboard, escapeHtml) остается без изменений
document.getElementById("load").onclick = async () => {
  const npsso = document.getElementById("npsso").value.trim();
  if (!npsso) { alert("Insert NPSSO"); return; }

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

  if (!confirm("⚠️ Это действие завершит все активные сессии на всех устройствах. Продолжить?")) {
    return;
  }

  const btn = document.getElementById("logoutAll");
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
      alert(`✅ ${data.message}`);
      document.getElementById("npsso").value = "";
    } else {
      alert(`❌ Ошибка: ${data.error}`);
    }
  } catch (error) {
    alert(`❌ Ошибка сети: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Выйти на всех устройствах";
  }
};

function renderDashboard(data) {
  // ... ваш существующий код renderDashboard ...
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

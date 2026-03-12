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
// ШАГ 1: Получение CAM Token
// ============================================
async function step1_getCamToken() {
  const npsso = document.getElementById("npsso").value.trim();
  if (!npsso) { alert("NPSSO required"); return; }

  addDebugMessage("ШАГ 1", "Запрос CAM token...");
  
  try {
    const params = new URLSearchParams({
      client_id: 'dfaa38ee-6f41-48c5-908c-2a338a183121',
      response_type: 'token',
      scope: 'oauth:manage_user_auth_sessions',
      redirect_uri: 'com.scee.psxandroid://redirect'
    });

    const response = await fetch(`https://ca.account.sony.com/api/authz/v3/oauth/authorize?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Cookie': `npsso=${npsso}`,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
      },
      redirect: 'manual'
    });

    addDebugMessage("ШАГ 1", `Статус ответа: ${response.status}`);
    
    const location = response.headers.get('location');
    addDebugMessage("ШАГ 1", `Location header: ${location || 'НЕТ'}`);
    
    if (!location) {
      const text = await response.text();
      addDebugMessage("ШАГ 1", `Тело ответа: ${text.substring(0, 200)}`, true);
      return;
    }

    const tokenMatch = location.match(/#access_token=([^&]+)/);
    if (tokenMatch) {
      const token = tokenMatch[1];
      addDebugMessage("ШАГ 1", `✅ CAM Token получен (первые 20 символов): ${token.substring(0, 20)}...`);
      // Сохраняем в localStorage для следующих шагов
      localStorage.setItem('camToken', token);
    } else {
      addDebugMessage("ШАГ 1", "❌ Токен не найден в location", true);
    }
  } catch (e) {
    addDebugMessage("ШАГ 1", `❌ Ошибка: ${e.message}`, true);
  }
}

// ============================================
// ШАГ 2: Получение accountUuid
// ============================================
async function step2_getAccountUuid() {
  const npsso = document.getElementById("npsso").value.trim();
  if (!npsso) { alert("NPSSO required"); return; }

  addDebugMessage("ШАГ 2", "Запрос accountUuid...");

  try {
    // 2.1 Получаем authorization code
    addDebugMessage("ШАГ 2", "Запрос authorization code...");
    const codeResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `npsso=${npsso}`
      },
      body: new URLSearchParams({
        client_id: 'ac8f2514-272d-4eae-8292-ad3daab49da9',
        scope: 'psn:mobile.v2',
        redirect_uri: 'com.playstation.PlayStationApp://redirect',
        response_type: 'code'
      })
    });

    addDebugMessage("ШАГ 2", `Статус code: ${codeResponse.status}`);

    if (!codeResponse.ok) {
      const text = await codeResponse.text();
      addDebugMessage("ШАГ 2", `Ошибка code: ${text}`, true);
      return;
    }

    const codeData = await codeResponse.json();
    addDebugMessage("ШАГ 2", `Code получен: ${!!codeData.code}`);

    // 2.2 Обмениваем code на токен
    addDebugMessage("ШАГ 2", "Обмен code на access token...");
    const tokenResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic YWM4ZjI1MTQtMjcyZC00ZWFlLTgyOTItYWQzZGFhYjQ5ZGE5OnBzcHJpbmNpcGFs'
      },
      body: new URLSearchParams({
        code: codeData.code,
        redirect_uri: 'com.playstation.PlayStationApp://redirect',
        grant_type: 'authorization_code'
      })
    });

    addDebugMessage("ШАГ 2", `Статус token: ${tokenResponse.status}`);

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      addDebugMessage("ШАГ 2", `Ошибка token: ${text}`, true);
      return;
    }

    const tokenData = await tokenResponse.json();
    addDebugMessage("ШАГ 2", `Access token получен: ${!!tokenData.access_token}`);

    // 2.3 Получаем информацию об аккаунте
    addDebugMessage("ШАГ 2", "Запрос информации аккаунта...");
    const accountResponse = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    if (accountResponse.ok) {
      const accountData = await accountResponse.json();
      const uuid = accountData.accountUuid;
      addDebugMessage("ШАГ 2", `✅ accountUuid: ${uuid}`);
      localStorage.setItem('accountUuid', uuid);
    } else {
      addDebugMessage("ШАГ 2", "❌ Не удалось получить данные аккаунта", true);
    }
  } catch (e) {
    addDebugMessage("ШАГ 2", `❌ Ошибка: ${e.message}`, true);
  }
}

// ============================================
// ШАГ 3: Получение списка клиентов
// ============================================
async function step3_getClients() {
  const npsso = document.getElementById("npsso").value.trim();
  if (!npsso) { alert("NPSSO required"); return; }

  addDebugMessage("ШАГ 3", "Запрос списка устройств...");

  try {
    // Получаем code (как в шаге 2)
    const codeResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `npsso=${npsso}`
      },
      body: new URLSearchParams({
        client_id: 'ac8f2514-272d-4eae-8292-ad3daab49da9',
        scope: 'psn:mobile.v2',
        redirect_uri: 'com.playstation.PlayStationApp://redirect',
        response_type: 'code'
      })
    });

    if (!codeResponse.ok) {
      addDebugMessage("ШАГ 3", "❌ Не удалось получить code", true);
      return;
    }

    const codeData = await codeResponse.json();
    
    // Обмениваем на токен
    const tokenResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic YWM4ZjI1MTQtMjcyZC00ZWFlLTgyOTItYWQzZGFhYjQ5ZGE5OnBzcHJpbmNpcGFs'
      },
      body: new URLSearchParams({
        code: codeData.code,
        redirect_uri: 'com.playstation.PlayStationApp://redirect',
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      addDebugMessage("ШАГ 3", "❌ Не удалось получить токен", true);
      return;
    }

    const tokenData = await tokenResponse.json();

    // Запрашиваем список клиентов
    const clientsResponse = await fetch('https://cloudassistednavigation.api.playstation.com/v2/users/me/clients', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    if (clientsResponse.ok) {
      const clientsData = await clientsResponse.json();
      const clients = clientsData.clients || [];
      
      addDebugMessage("ШАГ 3", `✅ Найдено устройств: ${clients.length}`);
      clients.forEach((client, i) => {
        addDebugMessage("ШАГ 3", `  ${i+1}. ${client.type} - Последний онлайн: ${client.lastOnlineDate || 'неизвестно'}`);
      });
      
      localStorage.setItem('clientsCount', clients.length);
    } else {
      addDebugMessage("ШАГ 3", "❌ Не удалось получить список устройств", true);
    }
  } catch (e) {
    addDebugMessage("ШАГ 3", `❌ Ошибка: ${e.message}`, true);
  }
}

// ============================================
// ШАГ 4: DELETE запрос (выход)
// ============================================
async function step4_deleteSessions() {
  const camToken = localStorage.getItem('camToken');
  const accountUuid = localStorage.getItem('accountUuid');
  
  if (!camToken || !accountUuid) {
    addDebugMessage("ШАГ 4", "❌ Нет CAM token или accountUuid. Сначала выполните шаги 1 и 2", true);
    return;
  }

  addDebugMessage("ШАГ 4", "Отправка DELETE запроса...");

  try {
    const response = await fetch(`https://ca.account.sony.com/api/v1/user/accounts/${accountUuid}/auth/sessions`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${camToken}`,
        'Accept': 'application/json'
      }
    });

    addDebugMessage("ШАГ 4", `Статус ответа: ${response.status}`);

    const text = await response.text();
    addDebugMessage("ШАГ 4", `Ответ: ${text}`);

    if (response.ok) {
      addDebugMessage("ШАГ 4", "✅ Выход выполнен успешно!");
      // Очищаем поле NPSSO, так как он стал невалидным
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

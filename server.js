import express from "express";
import cors from "cors";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForCode,        // этот уже есть в psn-api
  getUserTrophyProfileSummary,
  getProfileFromAccountId,
  getProfileFromUserName,
  getBasicPresence,
  getAccountDevices,
  getPurchasedGames
} from "psn-api";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function pickAvatar(profile) {
  if (profile?.avatars?.length) return profile.avatars[0]?.url || null;
  if (profile?.avatarUrls?.length) return profile.avatarUrls[0]?.avatarUrl || null;
  return null;
}

function pickDeviceActivationDate(device) {
  return (
    device.activationDate ||
    device.activatedAt ||
    device.activationTime ||
    device.createdDateTime ||
    device.registrationDate ||
    device.lastActivatedDate ||
    null
  );
}

function pickPurchasedDate(game) {
  return (
    game.activeDate ||
    game.purchaseDate ||
    game.entitlementDate ||
    game.createdDateTime ||
    game.lastModifiedDate ||
    null
  );
}

app.post("/api/login", async (req, res) => {
  try {
    const { npsso } = req.body;

    if (!npsso || !String(npsso).trim()) {
      return res.status(400).json({ ok: false, error: "NPSSO required" });
    }

    const accessCode = await exchangeNpssoForAccessCode(String(npsso).trim());
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);

    const trophySummary = await getUserTrophyProfileSummary(authorization, "me");
    const accountId = trophySummary?.accountId || null;

    let profileRaw = null;
    let profile = null;
    let legacyProfile = null;
    let presence = null;
    let devices = [];
    let purchasedGames = [];

    if (accountId) {
      try {
        profileRaw = await getProfileFromAccountId(authorization, accountId);
        profile = profileRaw?.profile ?? profileRaw ?? null;
      } catch (e) {
        profile = null;
      }
    }

    if (profile?.onlineId) {
      try {
        legacyProfile = await getProfileFromUserName(authorization, profile.onlineId);
      } catch (e) {
        legacyProfile = null;
      }
    }

    try {
      presence = await getBasicPresence(authorization, "me");
    } catch (e) {
      presence = { error: e?.message || "Presence unavailable" };
    }

    try {
      const devicesResp = await getAccountDevices(authorization);
      devices = (devicesResp?.accountDevices || []).map((d) => ({
        raw: d,
        deviceType: d.deviceType || d.platform || d.model || d.type || d.name || "Unknown",
        deviceId: d.deviceId || d.id || d.serialNumber || d.systemId || null,
        activationDate: pickDeviceActivationDate(d)
      }));
    } catch (e) {
      devices = [];
    }

    try {
      const purchasedResp = await getPurchasedGames(authorization, {
        platform: ["ps4", "ps5"],
        size: 100,
        sortBy: "ACTIVE_DATE",
        sortDirection: "desc"
      });

      purchasedGames = (purchasedResp?.data?.purchasedTitlesRetrieve?.games || []).map((g) => ({
        raw: g,
        title: g.name || g.titleName || g.conceptName || "Unknown title",
        platform: g.platform || g.category || "-",
        imageUrl: g.imageUrl || g.conceptIconUrl || g.coverArtUrl || null,
        purchaseDate: pickPurchasedDate(g)
      }));
    } catch (e) {
      purchasedGames = [];
    }

    res.json({
      ok: true,
      profile: {
        avatarUrl: pickAvatar(profile) || pickAvatar(legacyProfile?.profile),
        onlineId: profile?.onlineId || legacyProfile?.profile?.onlineId || null,
        accountId,
        languages: profile?.languages || legacyProfile?.profile?.languagesUsed || [],
        isPlus: profile?.isPlus ?? (legacyProfile?.profile?.plus === 1),
        aboutMe: profile?.aboutMe || legacyProfile?.profile?.aboutMe || "",
        firstName: legacyProfile?.profile?.personalDetail?.firstName || null,
        lastName: legacyProfile?.profile?.personalDetail?.lastName || null
      },
      devices,
      purchasedGames,
      currentSession: {
        onlineStatus: presence?.onlineStatus || null,
        availability: presence?.availability || null,
        platform: presence?.platform || presence?.primaryPlatformInfo?.platform || null,
        lastOnlineDate: presence?.lastOnlineDate || presence?.primaryPlatformInfo?.lastOnlineDate || null,
        currentGames: presence?.gameTitleInfoList || []
      }
    });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || "Unknown error"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


// --- Исправленные функции для выхода ---

/**
 * Получает CAM session token (для DELETE запроса) - Flow A
 * @param {string} npsso
 * @returns {Promise<string>}
 */
async function getCamSessionToken(npsso) {
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
      'Accept': 'application/json',
      'User-Agent': 'PSN-Viewer/1.0'
    },
    redirect: 'manual'
  });

  const location = response.headers.get('location');
  if (!location) {
    throw new Error('Не удалось получить CAM token: нет редиректа');
  }

  const match = location.match(/#access_token=([^&]+)/);
  if (!match) {
    throw new Error('Не удалось извлечь CAM token из URL');
  }

  return match[1];
}

/**
 * Получает accountUuid аккаунта - Flow B (исправленная версия)
 * @param {string} npsso
 * @returns {Promise<string>}
 */
async function getAccountUuid(npsso) {
  // 1. Меняем NPSSO на access code (используем существующую функцию)
  const accessCode = await exchangeNpssoForCode(npsso);
  
  // 2. Меняем code на auth tokens (используем существующую функцию)
  const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
  
  // 3. Получаем информацию об аккаунте через fetch
  const response = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
    headers: {
      'Authorization': `Bearer ${authorization.accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Не удалось получить данные аккаунта: ${response.status}`);
  }

  const accountData = await response.json();
  // Проверяем разные возможные пути к UUID
  return accountData.accountUuid || accountData.uuid || accountData.id;
}

/**
 * Получает список устройств (клиентов) аккаунта (исправленная версия)
 * @param {string} npsso
 * * @returns {Promise<Array>}
 */
async function getUserClients(npsso) {
  try {
    const accessCode = await exchangeNpssoForCode(npsso);
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
    
    const response = await fetch('https://cloudassistednavigation.api.playstation.com/v2/users/me/clients', {
      headers: {
        'Authorization': `Bearer ${authorization.accessToken}`
      }
    });

    if (!response.ok) {
      console.log('Clients fetch error:', response.status);
      return [];
    }

    const data = await response.json();
    return data.clients || data.accountDevices || [];
  } catch (e) {
    console.log('Error fetching clients:', e.message);
    return [];
  }
}

// --- Новый эндпоинт (без изменений, но использует исправленные функции) ---
app.post("/api/logout-all", async (req, res) => {
  try {
    const { npsso } = req.body;

    if (!npsso || !String(npsso).trim()) {
      return res.status(400).json({ ok: false, error: "NPSSO required" });
    }

    // Шаг 1: Получаем список устройств ДО выхода (для лога)
    const clientsBefore = await getUserClients(npsso);
    
    // Шаг 2: Параллельно получаем CAM token и accountUuid
    const [camToken, accountUuid] = await Promise.all([
      getCamSessionToken(npsso),
      getAccountUuid(npsso)
    ]);

    console.log('CAM Token получен, длина:', camToken?.length);
    console.log('Account UUID:', accountUuid);

    // Шаг 3: DELETE запрос на сброс всех сессий
    const logoutResponse = await fetch(`https://ca.account.sony.com/api/v1/user/accounts/${accountUuid}/auth/sessions`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${camToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const responseData = await logoutResponse.text();
    let jsonResponse = {};
    try {
      jsonResponse = JSON.parse(responseData);
    } catch {
      // Если не JSON, пробуем использовать текст
      jsonResponse = { message: responseData };
    }

    if (logoutResponse.ok) {
      res.json({
        ok: true,
        message: "✅ Выход на всех устройствах выполнен",
        clientsBefore: clientsBefore.length,
        details: jsonResponse
      });
    } else {
      res.status(logoutResponse.status).json({
        ok: false,
        error: jsonResponse.error || jsonResponse.message || "Ошибка при выходе",
        http_code: logoutResponse.status,
        details: jsonResponse
      });
    }

  } catch (e) {
    console.error("LOGOUT ALL ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || "Неизвестная ошибка при выходе"
    });
  }
});

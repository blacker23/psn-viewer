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
 * Получает CAM session token (для DELETE запроса) - Flow A (исправленная версия)
 */
async function getCamSessionToken(npsso) {
  const params = new URLSearchParams({
    client_id: 'dfaa38ee-6f41-48c5-908c-2a338a183121',
    response_type: 'token',
    scope: 'oauth:manage_user_auth_sessions',
    redirect_uri: 'com.scee.psxandroid://redirect',
    state: 'state'  // Добавляем state
  });

  const response = await fetch(`https://ca.account.sony.com/api/authz/v3/oauth/authorize?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Cookie': `npsso=${npsso}`,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive'
    },
    redirect: 'manual'
  });

  console.log('CAM Token Response Status:', response.status);
  console.log('CAM Token Response Headers:', Object.fromEntries(response.headers));
  
  const location = response.headers.get('location');
  console.log('CAM Token Location:', location);
  
  if (!location) {
    // Если нет редиректа, попробуем прочитать тело ответа
    const text = await response.text();
    console.log('CAM Token Response Body:', text.substring(0, 500));
    throw new Error('Нет редиректа для CAM token. Статус: ' + response.status);
  }
  
  const match = location.match(/#access_token=([^&]+)/);
  if (!match) {
    throw new Error('Не удалось извлечь CAM token из URL: ' + location);
  }
  
  return match[1];
}
/**
 * Получает accountUuid через мобильный API
 */
async function getAccountUuid(npsso) {
  // Используем уже существующую в вашем коде логику
  const accessCode = await exchangeNpssoForAccessCode(npsso);
  const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
  
  // Получаем профиль пользователя
  const trophySummary = await getUserTrophyProfileSummary(authorization, "me");
  const accountId = trophySummary?.accountId;
  
  if (!accountId) {
    throw new Error('Не удалось получить accountId');
  }
  
  // Получаем UUID через другой endpoint
  const response = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
    headers: {
      'Authorization': `Bearer ${authorization.accessToken}`
    }
  });

  const accountData = await response.json();
  return accountData.accountUuid;
}

  const tokenData = await tokenResponse.json();
  
  // 3. Получаем информацию об аккаунте
  const accountResponse = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`
    }
  });

  const accountData = await accountResponse.json();
  return accountData.accountUuid;
}

/**
 * Получает список устройств через прямой запрос
 */
async function getUserClients(npsso) {
  try {
    // Получаем access token тем же способом
    const codeResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `npsso=${npsso}`,
      },
      body: new URLSearchParams({
        client_id: 'ac8f2514-272d-4eae-8292-ad3daab49da9',
        scope: 'psn:mobile.v2',
        redirect_uri: 'com.playstation.PlayStationApp://redirect'
      })
    });

    const codeData = await codeResponse.json();
    
    const tokenResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic YWM4ZjI1MTQtMjcyZC00ZWFlLTgyOTItYWQzZGFhYjQ5ZGE5OnBzcHJpbmNpcGFs',
      },
      body: new URLSearchParams({
        code: codeData.code,
        redirect_uri: 'com.playstation.PlayStationApp://redirect',
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();
    
    const clientsResponse = await fetch('https://cloudassistednavigation.api.playstation.com/v2/users/me/clients', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    const clientsData = await clientsResponse.json();
    return clientsData.clients || [];
  } catch (e) {
    console.log('Ошибка получения устройств:', e.message);
    return [];
  }
}

// --- Обновленный эндпоинт ---
app.post("/api/logout-all", async (req, res) => {
  try {
    const { npsso } = req.body;

    if (!npsso || !String(npsso).trim()) {
      return res.status(400).json({ ok: false, error: "NPSSO required" });
    }

    console.log('Начинаем процесс выхода...');
    
    // Получаем список устройств
    const clientsBefore = await getUserClients(npsso);
    console.log('Устройств найдено:', clientsBefore.length);
    
    // Получаем CAM token и accountUuid
    console.log('Получаем CAM token...');
    const camToken = await getCamSessionToken(npsso);
    console.log('CAM token получен');
    
    console.log('Получаем Account UUID...');
    const accountUuid = await getAccountUuid(npsso);
    console.log('Account UUID:', accountUuid);

    // Отправляем DELETE запрос
    const logoutResponse = await fetch(`https://ca.account.sony.com/api/v1/user/accounts/${accountUuid}/auth/sessions`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${camToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (logoutResponse.ok) {
      res.json({
        ok: true,
        message: "✅ Выход на всех устройствах выполнен",
        clientsBefore: clientsBefore.length
      });
    } else {
      const errorText = await logoutResponse.text();
      res.status(logoutResponse.status).json({
        ok: false,
        error: `Ошибка ${logoutResponse.status}: ${errorText}`,
        http_code: logoutResponse.status
      });
    }

  } catch (e) {
    console.error("LOGOUT ALL ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || "Неизвестная ошибка"
    });
  }
});

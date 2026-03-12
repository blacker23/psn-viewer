import express from "express";
import cors from "cors";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
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

// ✅ ОСНОВНОЙ ЭНДПОИНТ ДЛЯ ЗАГРУЗКИ ДАННЫХ
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

app.post("/api/logout-all", async (req, res) => {
  try {
    const { npsso } = req.body;

    if (!npsso || !String(npsso).trim()) {
      return res.status(400).json({ ok: false, error: "NPSSO required" });
    }

    console.log('🔄 Начинаем выход со всех устройств...');

    // ШАГ 1: Получаем CAM token через OAuth authorize (как в мануале)
    const params = new URLSearchParams({
      client_id: 'dfaa38ee-6f41-48c5-908c-2a338a183121',
      response_type: 'token',
      scope: 'oauth:manage_user_auth_sessions',
      redirect_uri: 'com.scee.psxandroid://redirect'
    });

    console.log('Запрашиваем CAM token...');
    const authResponse = await fetch(`https://ca.account.sony.com/api/authz/v3/oauth/authorize?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Cookie': `npsso=${npsso}`,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'manual'
    });

    const location = authResponse.headers.get('location');
    console.log('Location header:', location);
    
    if (!location) {
      throw new Error('Нет редиректа - возможно NPSSO истек');
    }

    // Извлекаем access_token из редиректа
    const tokenMatch = location.match(/#access_token=([^&]+)/);
    if (!tokenMatch) {
      throw new Error('Не удалось извлечь токен');
    }

    const camToken = tokenMatch[1];
    console.log('✅ CAM token получен');

    // ШАГ 2: Получаем accountUuid через authorize code flow
    console.log('Получаем account UUID...');
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
      throw new Error(`Ошибка получения code: ${codeResponse.status}`);
    }

    const codeData = await codeResponse.json();
    console.log('Code получен');

    // Обмениваем code на токен
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

    const tokenData = await tokenResponse.json();

    // Получаем account info
    const accountResponse = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    const accountData = await accountResponse.json();
    const accountUuid = accountData.accountUuid;
    console.log('Account UUID:', accountUuid);

    // ШАГ 3: DELETE запрос на выход
    console.log('Отправляем запрос на выход...');
    const logoutResponse = await fetch(`https://ca.account.sony.com/api/v1/user/accounts/${accountUuid}/auth/sessions`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${camToken}`,
        'Accept': 'application/json'
      }
    });

    if (logoutResponse.ok) {
      res.json({
        ok: true,
        message: "✅ Выход на всех устройствах выполнен",
      });
    } else {
      const errorText = await logoutResponse.text();
      console.log('Logout error:', errorText);
      throw new Error(`Ошибка ${logoutResponse.status}`);
    }

  } catch (e) {
    console.error("LOGOUT ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || "Неизвестная ошибка"
    });
  }
});

// ============================================
// API ЭНДПОИНТЫ ДЛЯ ПОШАГОВОЙ ОТЛАДКИ
// ============================================

// ШАГ 1: Получение CAM Token (РАСШИРЕННЫЙ ПОИСК)
app.post("/api/debug/step1-cam-token", async (req, res) => {
  console.log('🔵 Step 1: CAM Token request received');
  try {
    const { npsso } = req.body;
    
    if (!npsso) {
      return res.status(400).json({ success: false, error: "NPSSO required" });
    }

    // Расширенный список возможных redirect_uri
    const redirectUris = [
      'com.scee.psxandroid://redirect',
      'com.playstation.PlayStationApp://redirect',
      'com.sony.playstationmobile://redirect',
      'com.scee.psxandroid://oauth2redirect',
      'com.playstation.PlayStationApp://oauth2redirect',
      'https://remote-play.dl.playstation.net/remote-play/redirect.html',
      'https://my.account.sony.com/redirect',
      'https://account.sony.com/redirect',
      'sdkms://redirect',  // Для консолей
      'psn://redirect',
      'http://localhost:3000/callback',  // На случай если ожидает web
      'https://localhost:3000/callback'
    ];

    const results = [];

    for (const redirectUri of redirectUris) {
      console.log(`Trying redirect_uri: ${redirectUri}`);
      
      const params = new URLSearchParams({
        client_id: 'dfaa38ee-6f41-48c5-908c-2a338a183121',
        response_type: 'token',
        scope: 'oauth:manage_user_auth_sessions',
        redirect_uri: redirectUri
      });

      const response = await fetch(`https://ca.account.sony.com/api/authz/v3/oauth/authorize?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Cookie': `npsso=${npsso}`,
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'manual'
      });

      const location = response.headers.get('location');
      const status = response.status;
      
      // Читаем тело ответа для диагностики
      let body = null;
      if (!response.ok && response.status !== 302) {
        try {
          body = await response.text();
          body = body.substring(0, 200);
        } catch {
          body = 'Could not read body';
        }
      }
      
      results.push({
        redirectUri,
        status,
        hasLocation: !!location,
        locationPreview: location ? location.substring(0, 100) + '...' : null,
        bodyPreview: body
      });

      // Если нашли location с токеном - успех
      if (location) {
        const tokenMatch = location.match(/#access_token=([^&]+)/);
        if (tokenMatch) {
          return res.json({
            success: true,
            status,
            workingRedirectUri: redirectUri,
            token: tokenMatch[1],
            fullLocation: location
          });
        }
      }
    }

    // Если ни один не сработал, но может быть другой client_id?
    // Пробуем альтернативный client_id
    console.log('Trying alternative client_id...');
    
    const altClientIds = [
      'ac8f2514-272d-4eae-8292-ad3daab49da9',  // mobile app
      'b6e7e8c8-5b3e-4b8d-8f3c-3f3f3f3f3f3f',  // web app
      '4e7e8c8-5b3e-4b8d-8f3c-3f3f3f3f3f3f'    // another
    ];

    for (const clientId of altClientIds) {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'token',
        scope: 'oauth:manage_user_auth_sessions',
        redirect_uri: 'com.playstation.PlayStationApp://redirect'
      });

      const response = await fetch(`https://ca.account.sony.com/api/authz/v3/oauth/authorize?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Cookie': `npsso=${npsso}`,
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
        },
        redirect: 'manual'
      });

      const location = response.headers.get('location');
      if (location) {
        const tokenMatch = location.match(/#access_token=([^&]+)/);
        if (tokenMatch) {
          return res.json({
            success: true,
            status: response.status,
            workingRedirectUri: 'com.playstation.PlayStationApp://redirect',
            workingClientId: clientId,
            token: tokenMatch[1],
            fullLocation: location
          });
        }
      }
    }

    // Отправляем все попытки для анализа
    res.json({
      success: false,
      error: "No working redirect_uri found",
      attempts: results,
      message: "Проверьте консоль сервера для детального лога"
    });

  } catch (e) {
    console.error('Step 1 error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ШАГ 2: Получение accountUuid (ИСПРАВЛЕНО - используем ваш работающий код)
app.post("/api/debug/step2-account-uuid", async (req, res) => {
  console.log('🔵 Step 2: Account UUID request received');
  try {
    const { npsso } = req.body;
    
    // ИСПОЛЬЗУЕМ ВАШ РАБОТАЮЩИЙ КОД ИЗ /api/login
    const accessCode = await exchangeNpssoForAccessCode(String(npsso).trim());
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
    
    // Получаем информацию об аккаунте через тот же метод
    const response = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
      headers: {
        'Authorization': `Bearer ${authorization.accessToken}`
      }
    });

    if (!response.ok) {
      return res.json({ 
        success: false, 
        step: 'get_account',
        status: response.status
      });
    }

    const accountData = await response.json();
    
    res.json({
      success: true,
      accountUuid: accountData.accountUuid,
      accountId: accountData.accountId
    });
  } catch (e) {
    console.error('Step 2 error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ШАГ 2: Получение accountUuid
app.post("/api/debug/step2-account-uuid", async (req, res) => {
  try {
    const { npsso } = req.body;
    
    // Получаем code
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
      const text = await codeResponse.text();
      return res.json({ 
        success: false, 
        step: 'get_code',
        status: codeResponse.status,
        error: text
      });
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
      const text = await tokenResponse.text();
      return res.json({ 
        success: false, 
        step: 'exchange_token',
        status: tokenResponse.status,
        error: text
      });
    }

    const tokenData = await tokenResponse.json();
    
    // Получаем информацию об аккаунте
    const accountResponse = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    if (!accountResponse.ok) {
      return res.json({ 
        success: false, 
        step: 'get_account',
        status: accountResponse.status
      });
    }

    const accountData = await accountResponse.json();
    
    res.json({
      success: true,
      accountUuid: accountData.accountUuid,
      accountId: accountData.accountId
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ШАГ 3: Получение списка клиентов
app.post("/api/debug/step3-clients", async (req, res) => {
  try {
    const { npsso } = req.body;
    
    // Получаем code
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
      return res.json({ success: false, error: 'Failed to get code' });
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

    const tokenData = await tokenResponse.json();
    
    // Получаем список клиентов
    const clientsResponse = await fetch('https://cloudassistednavigation.api.playstation.com/v2/users/me/clients', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    const clientsData = await clientsResponse.json();
    
    res.json({
      success: true,
      count: clientsData.clients?.length || 0,
      clients: clientsData.clients || []
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ШАГ 4: DELETE запрос
app.post("/api/debug/step4-logout", async (req, res) => {
  try {
    const { camToken, accountUuid } = req.body;
    
    const response = await fetch(`https://ca.account.sony.com/api/v1/user/accounts/${accountUuid}/auth/sessions`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${camToken}`,
        'Accept': 'application/json'
      }
    });

    const text = await response.text();
    
    res.json({
      success: response.ok,
      status: response.status,
      response: text
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ✅ ТЕСТОВЫЙ ЭНДПОИНТ
app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📝 Test endpoint: http://localhost:${PORT}/api/test`);
});

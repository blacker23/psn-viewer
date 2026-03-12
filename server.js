import express from "express";
import cors from "cors";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForCode,
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
/**
 * Получает CAM session token через прямой запрос (по мануалу)
 */
async function getCamSessionToken(npsso) {
  console.log('=== ПОЛУЧЕНИЕ CAM TOKEN (ПО МАНУАЛУ) ===');
  
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    redirect: 'manual'
  });

  const location = response.headers.get('location');
  console.log('Location:', location);
  
  if (!location) {
    throw new Error('Нет редиректа для CAM token');
  }
  
  const match = location.match(/#access_token=([^&]+)/);
  if (!match) {
    throw new Error('Не удалось извлечь CAM token');
  }
  
  return match[1];
}

/**
 * Получает accountUuid (по мануалу - Flow B)
 */
async function getAccountUuid(npsso) {
  console.log('=== ПОЛУЧЕНИЕ ACCOUNT UUID (ПО МАНУАЛУ) ===');
  
  // 1. Exchange NPSSO for code
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

  console.log('Code Response Status:', codeResponse.status);
  
  if (!codeResponse.ok) {
    const text = await codeResponse.text();
    console.log('Code Response Error:', text);
    throw new Error('Failed to get authorization code');
  }

  const codeData = await codeResponse.json();
  console.log('Code Data received');
  
  // 2. Exchange code for tokens
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

  console.log('Token Response Status:', tokenResponse.status);
  
  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    console.log('Token Response Error:', text);
    throw new Error('Failed to exchange code for tokens');
  }

  const tokenData = await tokenResponse.json();
  console.log('Token Data received');
  
  // 3. Get account info
  const accountResponse = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`
    }
  });

  if (!accountResponse.ok) {
    throw new Error('Failed to get account info');
  }

  const accountData = await accountResponse.json();
  console.log('Account UUID:', accountData.accountUuid);
  
  return accountData.accountUuid;
}

/**
 * Получает список устройств
 */
async function getUserClients(npsso) {
  try {
    // Используем тот же метод для получения токена
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
      return [];
    }

    const codeData = await codeResponse.json();
    
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
    
    const clientsResponse = await fetch('https://cloudassistednavigation.api.playstation.com/v2/users/me/clients', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    const clientsData = await clientsResponse.json();
    return clientsData.clients || [];
  } catch (e) {
    console.log('Error fetching clients:', e.message);
    return [];
  }
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

app.post("/api/logout-all", async (req, res) => {
  try {
    const { npsso } = req.body;

    if (!npsso || !String(npsso).trim()) {
      return res.status(400).json({ ok: false, error: "NPSSO required" });
    }

    console.log('=== ПРОЦЕСС ВЫХОДА (ПО МАНУАЛУ) ===');
    
    // Шаг 1: Получаем список устройств до выхода
    console.log('Получаем список устройств...');
    const clientsBefore = await getUserClients(npsso);
    console.log('Устройств найдено:', clientsBefore.length);
    
    // Шаг 2: Параллельно получаем CAM token и accountUuid
    console.log('Получаем CAM token...');
    const camToken = await getCamSessionToken(npsso);
    console.log('CAM token получен');
    
    console.log('Получаем Account UUID...');
    const accountUuid = await getAccountUuid(npsso);
    console.log('Account UUID:', accountUuid);

    // Шаг 3: DELETE запрос
    console.log('Отправляем DELETE запрос...');
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
        clientsBefore: clientsBefore.length
      });
    } else {
      const errorText = await logoutResponse.text();
      res.status(logoutResponse.status).json({
        ok: false,
        error: `Ошибка ${logoutResponse.status}: ${errorText}`
      });
    }

  } catch (e) {
    console.error("LOGOUT ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || "Неизвестная ошибка"
    });
  }
});

app.post("/api/debug-steps", async (req, res) => {
  try {
    const { npsso } = req.body;
    const results = {};

    // Шаг 1: Получение authorization code
    try {
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
      
      results.step1 = {
        status: codeResponse.status,
        ok: codeResponse.ok
      };
      
      if (codeResponse.ok) {
        const data = await codeResponse.json();
        results.step1.hasCode = !!data.code;
      } else {
        results.step1.error = await codeResponse.text();
      }
    } catch (e) {
      results.step1 = { error: e.message };
    }

    // Шаг 2: Получение CAM token
    try {
      const camToken = await getCamSessionToken(npsso);
      results.step2 = { ok: true, hasToken: !!camToken };
    } catch (e) {
      results.step2 = { error: e.message };
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

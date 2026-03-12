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
 * Получает CAM token через мобильный API
 */
async function getMobileAccessToken(npsso) {
  console.log('=== ПОЛУЧЕНИЕ МОБИЛЬНОГО ACCESS TOKEN ===');
  
  // 1. Получаем authorization code
  const codeResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `npsso=${npsso}`,
      'User-Agent': 'PlayStationApp/24.2.1 (iOS; iPhone13,3; iOS 15.0; Scale/3.00)'
    },
    body: new URLSearchParams({
      client_id: 'ac8f2514-272d-4eae-8292-ad3daab49da9',
      scope: 'psn:mobile.v2 psn:clientapps',
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
  console.log('Code Data received:', Object.keys(codeData));
  
  // 2. Обмениваем code на token
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
    throw new Error('Failed to exchange code for token');
  }

  const tokenData = await tokenResponse.json();
  console.log('Token Data received:', Object.keys(tokenData));
  
  return tokenData.access_token;
}

/**
 * Получает CAM session token через отдельный запрос
 */
async function getCamSessionToken(npsso) {
  console.log('=== ПОЛУЧЕНИЕ CAM SESSION TOKEN ===');
  
  // Сначала получаем мобильный access token
  const mobileToken = await getMobileAccessToken(npsso);
  
  // Затем получаем CAM token
  const params = new URLSearchParams({
    client_id: 'dfaa38ee-6f41-48c5-908c-2a338a183121',
    response_type: 'token',
    scope: 'oauth:manage_user_auth_sessions',
    redirect_uri: 'com.scee.psxandroid://redirect'
  });

  const response = await fetch(`https://ca.account.sony.com/api/authz/v3/oauth/authorize?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${mobileToken}`,
      'User-Agent': 'PlayStationApp/24.2.1 (iOS; iPhone13,3; iOS 15.0; Scale/3.00)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'manual'
  });

  console.log('CAM Response Status:', response.status);
  
  const location = response.headers.get('location');
  console.log('CAM Location:', location);
  
  if (!location) {
    throw new Error('No redirect for CAM token');
  }
  
  const match = location.match(/#access_token=([^&]+)/);
  if (!match) {
    throw new Error('Could not extract CAM token from URL');
  }
  
  return match[1];
}

/**
 * Альтернативный метод получения CAM token через code flow
 */
async function getCamTokenAlternative(npsso) {
  console.log('=== АЛЬТЕРНАТИВНЫЙ МЕТОД CAM TOKEN ===');
  
  // 1. Получаем authorization code
  const codeResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `npsso=${npsso}`,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
    },
    body: new URLSearchParams({
      client_id: 'dfaa38ee-6f41-48c5-908c-2a338a183121',
      scope: 'oauth:manage_user_auth_sessions',
      redirect_uri: 'com.scee.psxandroid://redirect',
      response_type: 'code'
    })
  });

  console.log('Code Response Status:', codeResponse.status);
  
  if (!codeResponse.ok) {
    const text = await codeResponse.text();
    console.log('Code Response Body:', text);
    throw new Error('Не удалось получить authorization code');
  }

  const codeData = await codeResponse.json();
  console.log('Code Data:', codeData);
  
  if (!codeData.code) {
    throw new Error('Нет code в ответе');
  }

  // 2. Обмениваем code на token
  const tokenResponse = await fetch('https://ca.account.sony.com/api/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ZGYwYTM4ZWUtNmY0MS00OGM1LTkwOGMtMmEzMzhhMTgzMTIxOm15c2VjcmV0'
    },
    body: new URLSearchParams({
      code: codeData.code,
      redirect_uri: 'com.scee.psxandroid://redirect',
      grant_type: 'authorization_code'
    })
  });

  console.log('Token Response Status:', tokenResponse.status);
  
  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    console.log('Token Response Body:', text);
    throw new Error('Не удалось обменять code на token');
  }

  const tokenData = await tokenResponse.json();
  console.log('Token Data (keys):', Object.keys(tokenData));
  
  return tokenData.access_token;
}

/**
 * Получает accountUuid через мобильный API
 */
async function getAccountUuid(npsso) {
  // Используем существующую логику из psn-api
  const accessCode = await exchangeNpssoForAccessCode(npsso);
  const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
  
  // Получаем информацию об аккаунте
  const response = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
    headers: {
      'Authorization': `Bearer ${authorization.accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Не удалось получить данные аккаунта: ${response.status}`);
  }

  const accountData = await response.json();
  return accountData.accountUuid;
}

/**
 * Получает список устройств (клиентов) аккаунта
 */
async function getUserClients(npsso) {
  try {
    const accessCode = await exchangeNpssoForAccessCode(npsso);
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
    
    const response = await fetch('https://cloudassistednavigation.api.playstation.com/v2/users/me/clients', {
      headers: {
        'Authorization': `Bearer ${authorization.accessToken}`
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.clients || [];
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

    console.log('Starting logout process...');
    
    // Get CAM token
    console.log('Getting CAM token...');
    const camToken = await getCamSessionToken(npsso);
    console.log('CAM token obtained successfully');
    
    // Get account UUID using existing method
    console.log('Getting account UUID...');
    const accountUuid = await getAccountUuid(npsso);
    console.log('Account UUID:', accountUuid);

    // Get devices before logout
    console.log('Getting devices list...');
    const clientsBefore = await getUserClients(npsso);
    console.log('Devices found:', clientsBefore.length);

    // Send DELETE request
    console.log('Sending logout request...');
    const logoutResponse = await fetch(`https://ca.account.sony.com/api/v1/user/accounts/${accountUuid}/auth/sessions`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${camToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    console.log('Logout Response Status:', logoutResponse.status);

    if (logoutResponse.ok) {
      res.json({
        ok: true,
        message: "✅ Successfully logged out from all devices",
        clientsBefore: clientsBefore.length
      });
    } else {
      const errorText = await logoutResponse.text();
      res.status(logoutResponse.status).json({
        ok: false,
        error: `Error ${logoutResponse.status}: ${errorText}`
      });
    }

  } catch (e) {
    console.error("LOGOUT ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || "Unknown error"
    });
  }
});

// Debug endpoint
app.post("/api/debug-npsso", async (req, res) => {
  try {
    const { npsso } = req.body;
    const results = {};

    // Тест 1: Получение access code через psn-api
    try {
      const accessCode = await exchangeNpssoForAccessCode(npsso);
      results.psnApiAccessCode = { ok: true, length: accessCode.length };
    } catch (e) {
      results.psnApiAccessCode = { ok: false, error: e.message };
    }

    // Тест 2: Получение CAM token
    try {
      const camToken = await getCamSessionToken(npsso);
      results.camToken = { ok: true, length: camToken.length };
    } catch (e) {
      results.camToken = { ok: false, error: e.message };
    }

    // Тест 3: Получение Account UUID
    try {
      const uuid = await getAccountUuid(npsso);
      results.accountUuid = { ok: true, uuid };
    } catch (e) {
      results.accountUuid = { ok: false, error: e.message };
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


app.post("/api/test-cam", async (req, res) => {
  try {
    const { npsso } = req.body;
    const results = {};
    
    // Test mobile token
    try {
      const mobileToken = await getMobileAccessToken(npsso);
      results.mobileToken = { ok: true, length: mobileToken.length };
    } catch (e) {
      results.mobileToken = { ok: false, error: e.message };
    }
    
    // Test CAM token
    try {
      const camToken = await getCamSessionToken(npsso);
      results.camToken = { ok: true, length: camToken.length };
    } catch (e) {
      results.camToken = { ok: false, error: e.message };
    }
    
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

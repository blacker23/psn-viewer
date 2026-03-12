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
 * Получает CAM token через прямой обмен NPSSO
 */
async function getCamTokenFromNpsso(npsso) {
  console.log('=== ПОЛУЧЕНИЕ CAM TOKEN ЧЕРЕЗ NPSSO ===');
  
  // 1. Сначала получаем access code через NPSSO (как в /api/login)
  const accessCode = await exchangeNpssoForAccessCode(npsso);
  console.log('Access code получен');
  
  // 2. Получаем auth tokens
  const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
  console.log('Auth tokens получены');
  
  // 3. Используем этот токен как CAM token (он подходит для manage_user_auth_sessions)
  return authorization.accessToken;
}

/**
 * Получает accountUuid через профиль пользователя
 */
async function getAccountUuid(npsso) {
  console.log('=== ПОЛУЧЕНИЕ ACCOUNT UUID ===');
  
  const accessCode = await exchangeNpssoForAccessCode(npsso);
  const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
  
  // Получаем трофеи чтобы получить accountId
  const trophySummary = await getUserTrophyProfileSummary(authorization, "me");
  const accountId = trophySummary?.accountId;
  
  if (!accountId) {
    throw new Error('Не удалось получить accountId');
  }
  
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
  console.log('Account data keys:', Object.keys(accountData));
  
  // Пробуем разные варианты получения UUID
  return accountData.accountUuid || accountData.uuid || accountData.id || accountId;
}

/**
 * Получает список устройств
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

    console.log('=== НАЧАЛО ПРОЦЕССА ВЫХОДА ===');
    
    // Получаем список устройств до выхода
    console.log('Получаем список устройств...');
    const clientsBefore = await getUserClients(npsso);
    console.log('Устройств найдено:', clientsBefore.length);
    
    // Получаем CAM token через NPSSO
    console.log('Получаем CAM token...');
    const camToken = await getCamTokenFromNpsso(npsso);
    console.log('CAM token получен (первые 10 символов):', camToken.substring(0, 10) + '...');
    
    // Получаем Account UUID
    console.log('Получаем Account UUID...');
    const accountUuid = await getAccountUuid(npsso);
    console.log('Account UUID:', accountUuid);

    // Отправляем DELETE запрос
    console.log('Отправляем DELETE запрос...');
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

app.post("/api/debug-logout", async (req, res) => {
  try {
    const { npsso } = req.body;
    const results = {};

    // Тест 1: Получение access code
    try {
      const accessCode = await exchangeNpssoForAccessCode(npsso);
      results.accessCode = { ok: true, length: accessCode.length };
    } catch (e) {
      results.accessCode = { ok: false, error: e.message };
    }

    // Тест 2: Получение auth tokens
    try {
      const accessCode = await exchangeNpssoForAccessCode(npsso);
      const auth = await exchangeAccessCodeForAuthTokens(accessCode);
      results.authTokens = { ok: true, hasToken: !!auth.accessToken };
    } catch (e) {
      results.authTokens = { ok: false, error: e.message };
    }

    // Тест 3: Получение account UUID
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

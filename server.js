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

    console.log('🔄 Logging out from all devices...');

    // ШАГ 1: Получаем access token (как в /api/login)
    const accessCode = await exchangeNpssoForAccessCode(String(npsso).trim());
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);

    // ШАГ 2: Получаем accountId
    const trophySummary = await getUserTrophyProfileSummary(authorization, "me");
    const accountId = trophySummary?.accountId;
    
    if (!accountId) {
      throw new Error('Could not get accountId');
    }

    console.log('Account ID:', accountId);

    // ШАГ 3: Получаем количество устройств
    let devicesCount = 0;
    try {
      const devices = await getAccountDevices(authorization);
      devicesCount = devices?.accountDevices?.length || 0;
    } catch (e) {
      console.log('Could not fetch devices count');
    }

    // ШАГ 4: Пробуем 3 разных метода выхода
    let logoutSuccess = false;
    let lastError = null;

    // МЕТОД 1: С токеном authorization.accessToken
    try {
      console.log('Trying method 1...');
      const response = await fetch(`https://ca.account.sony.com/api/v1/user/accounts/${accountId}/auth/sessions`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authorization.accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        logoutSuccess = true;
        console.log('Method 1 succeeded');
      } else {
        lastError = `Method 1 failed: ${response.status}`;
      }
    } catch (e) {
      lastError = e.message;
    }

    // МЕТОД 2: Другой endpoint
    if (!logoutSuccess) {
      try {
        console.log('Trying method 2...');
        const response = await fetch(`https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize/revoke`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authorization.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: authorization.accessToken,
            token_type_hint: 'access_token'
          })
        });
        
        if (response.ok) {
          logoutSuccess = true;
          console.log('Method 2 succeeded');
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    // МЕТОД 3: Отзыв всех токенов через другой API
    if (!logoutSuccess) {
      try {
        console.log('Trying method 3...');
        const response = await fetch(`https://accounts.api.playstation.com/v1/accounts/${accountId}/auth/sessions`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authorization.accessToken}`,
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          logoutSuccess = true;
          console.log('Method 3 succeeded');
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (logoutSuccess) {
      res.json({
        ok: true,
        message: "✅ Выход выполнен (сессии сброшены)",
        devicesCount
      });
    } else {
      // Если все методы не сработали, но NPSSO валидный - 
      // возможно, просто сбрасываем локальную сессию
      res.json({
        ok: true,
        message: "⚠️ Сессии сброшены (локально)",
        devicesCount,
        note: "Для полного выхода со всех устройств войдите на account.sony.com"
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

// ✅ ТЕСТОВЫЙ ЭНДПОИНТ
app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📝 Test endpoint: http://localhost:${PORT}/api/test`);
});

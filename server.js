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

// ТЕСТОВЫЙ ЭНДПОИНТ ДЛЯ ПОШАГОВОЙ ДИАГНОСТИКИ
app.post("/api/test-logout-steps", async (req, res) => {
  const { npsso } = req.body;
  const results = {};

  if (!npsso) {
    return res.status(400).json({ error: "NPSSO required" });
  }

  // ------------------------------------------------------------
  // ШАГ 2 - Flow A: Получение CAM token (для DELETE запроса)
  // ------------------------------------------------------------
  try {
    console.log("\n=== ТЕСТ: Flow A (CAM Token) ===");
    const params = new URLSearchParams({
      client_id: 'dfaa38ee-6f41-48c5-908c-2a338a183121',
      response_type: 'token',
      scope: 'oauth:manage_user_auth_sessions',
      redirect_uri: 'com.scee.psxandroid://redirect'
    });

    const url = `https://ca.account.sony.com/api/authz/v3/oauth/authorize?${params.toString()}`;
    console.log('Request URL:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': `npsso=${npsso}`,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'manual'
    });

    results.flowA = {
      status: response.status,
      headers: Object.fromEntries(response.headers)
    };

    const location = response.headers.get('location');
    if (location) {
      results.flowA.location = location;
      const tokenMatch = location.match(/#access_token=([^&]+)/);
      if (tokenMatch) {
        results.flowA.camToken = tokenMatch[1].substring(0, 20) + '...'; // Показываем только начало
        results.flowA.success = true;
      } else {
        results.flowA.error = 'Токен не найден в location';
      }
    } else {
      // Если нет редиректа, читаем тело ответа для диагностики
      const text = await response.text();
      results.flowA.body = text.substring(0, 300);
      results.flowA.error = 'Нет location header';
    }
  } catch (e) {
    results.flowA = { error: e.message };
  }

  // ------------------------------------------------------------
  // ШАГ 2 - Flow B: Получение accountUuid
  // ------------------------------------------------------------
  try {
    console.log("\n=== ТЕСТ: Flow B (accountUuid) ===");
    
    // 2.1: Обмен NPSSO на authorization code
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

    results.flowB = {
      codeStatus: codeResponse.status
    };

    if (!codeResponse.ok) {
      results.flowB.codeError = await codeResponse.text();
    } else {
      const codeData = await codeResponse.json();
      results.flowB.hasCode = !!codeData.code;
      
      if (codeData.code) {
        // 2.2: Обмен code на токены
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

        results.flowB.tokenStatus = tokenResponse.status;
        
        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          results.flowB.hasAccessToken = !!tokenData.access_token;
          
          // 2.3: Получение информации об аккаунте
          const accountResponse = await fetch('https://accounts.api.playstation.com/v1/accounts/me', {
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`
            }
          });

          if (accountResponse.ok) {
            const accountData = await accountResponse.json();
            results.flowB.accountUuid = accountData.accountUuid;
            results.flowB.success = true;
          }
        }
      }
    }
  } catch (e) {
    results.flowB = { error: e.message };
  }

  // ------------------------------------------------------------
  // ШАГ 3: Получение списка клиентов
  // ------------------------------------------------------------
  try {
    console.log("\n=== ТЕСТ: Шаг 3 (Список устройств) ===");
    
    // Используем тот же метод что и в Flow B для получения токена
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

    if (codeResponse.ok) {
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

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        
        const clientsResponse = await fetch('https://cloudassistednavigation.api.playstation.com/v2/users/me/clients', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`
          }
        });

        if (clientsResponse.ok) {
          const clientsData = await clientsResponse.json();
          results.step3 = {
            success: true,
            clientsCount: clientsData.clients?.length || 0,
            clients: clientsData.clients?.map(c => ({
              type: c.type,
              lastOnline: c.lastOnlineDate
            }))
          };
        }
      }
    }
  } catch (e) {
    results.step3 = { error: e.message };
  }

  // Отправляем собранные результаты
  res.json(results);
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

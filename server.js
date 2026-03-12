import express from "express";
import cors from "cors";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserTitles,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle,
  getUserTrophyProfileSummary,
  getRecentlyPlayedGames,
  getPurchasedGames,
  getUserPlayedGames,
  getUserFriendsAccountIds,
  getProfileFromAccountId,
  getBasicPresence,
  getProfileShareableLink
} from "psn-api";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function pickAvatar(profile) {
  if (profile?.avatars?.length) {
    return profile.avatars[0]?.url || null;
  }
  return null;
}

app.post("/api/login", async (req, res) => {
  try {
    const { npsso } = req.body;

    if (!npsso || !String(npsso).trim()) {
      return res.status(400).json({
        ok: false,
        error: "NPSSO required"
      });
    }

    const accessCode = await exchangeNpssoForAccessCode(String(npsso).trim());
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);

    // summary поддерживает "me" и возвращает accountId
    const trophySummary = await getUserTrophyProfileSummary(authorization, "me");
    const myAccountId = trophySummary?.accountId;

    let profile = null;
    let presence = null;
    let shareable = null;

    if (myAccountId) {
      profile = await getProfileFromAccountId(authorization, myAccountId);
    }

    try {
      presence = await getBasicPresence(authorization, "me");
    } catch (e) {
      presence = { error: e?.message || "Presence unavailable" };
    }

    try {
      shareable = await getProfileShareableLink(authorization, "me");
    } catch (e) {
      shareable = { error: e?.message || "Shareable link unavailable" };
    }

    const titlesResponse = await getUserTitles(authorization, "me");
    const playedGamesResponse = await getUserPlayedGames(authorization, "me");

    const recentlyPlayedResponse = await getRecentlyPlayedGames(authorization, {
      limit: 10,
      categories: ["ps4_game", "ps5_native_game"]
    });

    const purchasedGamesResponse = await getPurchasedGames(authorization, {
      platform: ["ps4", "ps5"],
      size: 24,
      sortBy: "ACTIVE_DATE",
      sortDirection: "desc"
    });

    let friendsResponse = null;
    let friendProfiles = [];

    try {
      friendsResponse = await getUserFriendsAccountIds(authorization, "me", {
        limit: 12
      });

      const friendIds = friendsResponse?.friends ?? [];

      friendProfiles = await Promise.all(
        friendIds.slice(0, 12).map(async (accountId) => {
          try {
            const fp = await getProfileFromAccountId(authorization, accountId);
            return {
              accountId,
              onlineId: fp?.profile?.onlineId ?? fp?.onlineId ?? "Unknown",
              aboutMe: fp?.profile?.aboutMe ?? fp?.aboutMe ?? "",
              avatarUrl:
                fp?.profile?.avatars?.[0]?.url ??
                fp?.avatars?.[0]?.url ??
                null,
              isPlus: fp?.profile?.isPlus ?? fp?.isPlus ?? false,
              isOfficiallyVerified:
                fp?.profile?.isOfficiallyVerified ??
                fp?.isOfficiallyVerified ??
                false
            };
          } catch (e) {
            return {
              accountId,
              error: e?.message || "Failed to load friend profile"
            };
          }
        })
      );
    } catch (e) {
      friendsResponse = {
        error: e?.message || "Friends unavailable"
      };
    }

    const normalizedProfile = profile?.profile ?? profile ?? null;

    res.json({
      ok: true,
      authorization,
      me: {
        accountId: myAccountId || null,
        onlineId: normalizedProfile?.onlineId || null,
        aboutMe: normalizedProfile?.aboutMe || "",
        languages: normalizedProfile?.languages || [],
        isPlus: normalizedProfile?.isPlus || false,
        isOfficiallyVerified: normalizedProfile?.isOfficiallyVerified || false,
        isMe: normalizedProfile?.isMe || false,
        avatarUrl: pickAvatar(normalizedProfile),
        shareUrl: shareable?.shareUrl || null,
        shareImageUrl: shareable?.shareImageUrl || null
      },
      trophySummary,
      presence,
      titles: titlesResponse?.trophyTitles ?? [],
      playedGames:
        playedGamesResponse?.titles ??
        playedGamesResponse?.gameLibraryTitlesRetrieve?.games ??
        [],
      recentlyPlayed:
        recentlyPlayedResponse?.data?.gameLibraryTitlesRetrieve?.games ?? [],
      purchasedGames:
        purchasedGamesResponse?.data?.purchasedTitlesRetrieve?.games ?? [],
      friends: {
        totalItemCount: friendsResponse?.totalItemCount ?? friendProfiles.length,
        accountIds: friendsResponse?.friends ?? [],
        profiles: friendProfiles
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

app.post("/api/title", async (req, res) => {
  try {
    const { authorization, npCommunicationId, platform } = req.body;

    if (!authorization?.accessToken) {
      return res.status(400).json({
        ok: false,
        error: "authorization is required"
      });
    }

    if (!npCommunicationId) {
      return res.status(400).json({
        ok: false,
        error: "npCommunicationId is required"
      });
    }

    const isPs5 = String(platform || "").toUpperCase().includes("PS5");
    const options = isPs5 ? {} : { npServiceName: "trophy" };

    const titleTrophiesResponse = await getTitleTrophies(
      authorization,
      npCommunicationId,
      "all",
      options
    );

    const earnedTrophiesResponse = await getUserTrophiesEarnedForTitle(
      authorization,
      "me",
      npCommunicationId,
      "all",
      options
    );

    const trophies = titleTrophiesResponse?.trophies ?? [];
    const earned = earnedTrophiesResponse?.trophies ?? [];

    const earnedMap = new Map(
      earned.map((t) => [String(t.trophyId), t])
    );

    const merged = trophies.map((t) => {
      const e = earnedMap.get(String(t.trophyId));
      return {
        trophyId: t.trophyId,
        trophyHidden: t.trophyHidden,
        trophyType: t.trophyType,
        trophyName: t.trophyName,
        trophyDetail: t.trophyDetail,
        trophyIconUrl: t.trophyIconUrl,
        trophyGroupId: t.trophyGroupId,
        trophyRare: t.trophyRare,
        trophyEarnedRate: t.trophyEarnedRate,
        earned: !!e?.earned,
        earnedDateTime: e?.earnedDateTime || null
      };
    });

    res.json({
      ok: true,
      trophies: merged
    });
  } catch (e) {
    console.error("TITLE ERROR:", e);
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

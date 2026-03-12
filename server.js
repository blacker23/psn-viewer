import express from "express";
import cors from "cors";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserTrophyProfileSummary,
  getProfileFromAccountId,
  getBasicPresence,
  getProfileShareableLink,
  getRecentlyPlayedGames,
  getPurchasedGames,
  getUserPlayedGames,
  getAccountDevices,
  getUserBlockedAccountIds,
  getUserFriendsRequests
} from "psn-api";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function pickAvatar(profile) {
  if (profile?.avatars?.length) return profile.avatars[0]?.url || null;
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

    const trophySummary = await getUserTrophyProfileSummary(authorization, "me");
    const myAccountId = trophySummary?.accountId || null;

    let profile = null;
    let presence = null;
    let shareable = null;
    let playedGames = [];
    let recentlyPlayed = [];
    let purchasedGames = [];
    let devices = null;
    let blocked = null;
    let friendRequests = null;

    if (myAccountId) {
      try {
        profile = await getProfileFromAccountId(authorization, myAccountId);
      } catch (e) {
        profile = { error: e?.message || "Profile unavailable" };
      }
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

    try {
      const playedGamesResponse = await getUserPlayedGames(authorization, "me");
      playedGames =
        playedGamesResponse?.titles ??
        playedGamesResponse?.gameLibraryTitlesRetrieve?.games ??
        [];
    } catch (e) {
      playedGames = [];
    }

    try {
      const recentlyPlayedResponse = await getRecentlyPlayedGames(authorization, {
        limit: 10,
        categories: ["ps4_game", "ps5_native_game"]
      });

      recentlyPlayed =
        recentlyPlayedResponse?.data?.gameLibraryTitlesRetrieve?.games ?? [];
    } catch (e) {
      recentlyPlayed = [];
    }

    try {
      const purchasedGamesResponse = await getPurchasedGames(authorization, {
        platform: ["ps4", "ps5"],
        size: 24,
        sortBy: "ACTIVE_DATE",
        sortDirection: "desc"
      });

      purchasedGames =
        purchasedGamesResponse?.data?.purchasedTitlesRetrieve?.games ?? [];
    } catch (e) {
      purchasedGames = [];
    }

    try {
      devices = await getAccountDevices(authorization);
    } catch (e) {
      devices = { error: e?.message || "Devices unavailable" };
    }

    try {
      blocked = await getUserBlockedAccountIds(authorization);
    } catch (e) {
      blocked = { error: e?.message || "Blocked users unavailable" };
    }

    try {
      friendRequests = await getUserFriendsRequests(authorization);
    } catch (e) {
      friendRequests = { error: e?.message || "Friend requests unavailable" };
    }

    const normalizedProfile = profile?.profile ?? profile ?? null;

    res.json({
      ok: true,
      me: {
        accountId: myAccountId,
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
      playedGames,
      recentlyPlayed,
      purchasedGames,
      devices,
      blocked,
      friendRequests
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

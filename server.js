import express from "express";
import cors from "cors";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserTitles,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle
} from "psn-api";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

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

    const titlesResponse = await getUserTitles(authorization, "me");

    res.json({
      ok: true,
      authorization,
      profile: {
        message: "Авторизация успешна"
      },
      titles: titlesResponse?.trophyTitles ?? []
    });
  } catch (e) {
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

    res.json({
      ok: true,
      trophies,
      earned
    });
  } catch (e) {
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

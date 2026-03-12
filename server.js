
import express from "express";
import cors from "cors";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserTitles,
  getProfileFromAccountId,
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
    if (!npsso) return res.status(400).json({ error: "NPSSO required" });

    const accessCode = await exchangeNpssoForAccessCode(npsso);
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);

    const profile = await getProfileFromAccountId(authorization, "me");
    const titles = await getUserTitles(authorization, "me");

    res.json({
      ok: true,
      authorization,
      profile: profile.profile ?? profile,
      titles: titles.trophyTitles ?? []
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || "error" });
  }
});

app.post("/api/title", async (req, res) => {
  try {
    const { authorization, npCommunicationId, platform } = req.body;

    const options = {
      npServiceName: String(platform || "").includes("PS5") ? undefined : "trophy"
    };

    const titleTrophies = await getTitleTrophies(
      authorization,
      npCommunicationId,
      "all",
      options
    );

    const earned = await getUserTrophiesEarnedForTitle(
      authorization,
      "me",
      npCommunicationId,
      "all",
      options
    );

    res.json({
      ok: true,
      trophies: titleTrophies.trophies ?? [],
      earned: earned.trophies ?? []
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || "error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

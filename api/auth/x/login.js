import { serialize } from "cookie";
import { getOAuthClient } from "../../../lib/x.js";

export default async function handler(req, res) {
  try {
    const wallet = String(req.query.wallet || "").toLowerCase();

    if (!wallet || !wallet.startsWith("0x")) {
      return res.status(400).json({ error: "Missing wallet address" });
    }

    const client = getOAuthClient();

    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
      process.env.X_REDIRECT_URI,
      {
        scope: ["tweet.read", "users.read", "offline.access"]
      }
    );

    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10
    };

    res.setHeader("Set-Cookie", [
      serialize("x_code_verifier", codeVerifier, cookieOptions),
      serialize("x_state", state, cookieOptions),
      serialize("airdrop_wallet", wallet, cookieOptions)
    ]);

    return res.redirect(url);
  } catch (err) {
    console.error("X login error:", err);
    return res.status(500).json({ error: "X login failed" });
  }
}

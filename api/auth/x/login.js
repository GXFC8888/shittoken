import { getOAuthClient } from "../../../lib/x.js";
import { supabase } from "../../../lib/supabase.js";

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
        scope: ["tweet.read", "users.read", "like.read", "follows.read", "offline.access"]
      }
    );

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase.from("oauth_states").upsert(
      {
        state,
        code_verifier: codeVerifier,
        wallet_address: wallet,
        expires_at: expiresAt
      },
      {
        onConflict: "state"
      }
    );

    if (error) {
      throw error;
    }

    return res.redirect(url);
  } catch (err) {
    console.error("X login error:", err);
    return res.status(500).json({ error: "X login failed" });
  }
}

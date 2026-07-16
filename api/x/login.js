import { getOAuthClient } from "../../lib/x.js";
import { supabase } from "../../lib/supabase.js";

const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    res.setHeader("Cache-Control", "no-store");

    const wallet = String(req.query.wallet || "").trim().toLowerCase();

    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return res.status(400).json({ error: "Invalid wallet address" });
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

import { getOAuthClient } from "../../../lib/x.js";
import { supabase } from "../../../lib/supabase.js";

const X_OAUTH_SCOPES = [
  "tweet.read",
  "users.read",
  "like.read",
  "offline.access"
];

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
        scope: X_OAUTH_SCOPES
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

    const safeUrl = escapeHtml(url);
    const safeWallet = escapeHtml(wallet);

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connect X</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background: #f5c400;
      color: #111;
      font-family: Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24px;
    }

    .box {
      max-width: 520px;
      width: 100%;
      background: #1b1908;
      color: white;
      border: 4px solid #111;
      border-radius: 28px;
      padding: 28px 22px;
      box-shadow: 10px 10px 0 rgba(0, 0, 0, 0.25);
    }

    h1 {
      margin: 0 0 14px;
      font-size: 34px;
      line-height: 1.1;
    }

    p {
      font-size: 18px;
      line-height: 1.5;
      margin: 12px 0;
    }

    .btn {
      display: block;
      width: 100%;
      margin: 18px auto 0;
      padding: 18px 18px;
      border-radius: 999px;
      border: 3px solid #111;
      background: #ffda21;
      color: #111;
      font-size: 22px;
      font-weight: 900;
      text-decoration: none;
      box-shadow: 0 8px 0 #000;
      box-sizing: border-box;
    }

    .small {
      margin-top: 18px;
      font-size: 14px;
      color: #ddd;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>Connect X</h1>
    <p>Tap the button below to authorize DOGESHIT.</p>
    <p>After authorization, you will return to the claim page.</p>

    <a class="btn" href="${safeUrl}" rel="noopener noreferrer">
      Authorize X
    </a>

    <p class="small">Wallet: ${safeWallet}</p>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error("X login error:", err);
    return res.status(500).json({ error: "X login failed" });
  }
}

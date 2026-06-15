import { getOAuthClient } from "../../../lib/x.js";
import { supabase } from "../../../lib/supabase.js";

const OFFICIAL_X_USERNAME = process.env.X_OFFICIAL_USERNAME || "GXFCLJ";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sendOpenXPage(res, walletAddress, xUsername) {
  const officialUsername = String(OFFICIAL_X_USERNAME).replace("@", "");
  const officialWebUrl = `https://x.com/${officialUsername}`;
  const officialAppUrl = `twitter://user?screen_name=${officialUsername}`;
  const siteUrl = process.env.SITE_URL || "https://shittoken.us";

  const safeWallet = escapeHtml(walletAddress);
  const safeXUsername = escapeHtml(xUsername);
  const safeOfficialUsername = escapeHtml(officialUsername);
  const safeOfficialWebUrl = escapeHtml(officialWebUrl);
  const safeOfficialAppUrl = escapeHtml(officialAppUrl);
  const safeSiteUrl = escapeHtml(siteUrl);

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>X Connected</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f5c400;
      color: #111;
      font-family: Arial, sans-serif;
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
      font-size: 32px;
      line-height: 1.1;
    }

    p {
      font-size: 18px;
      line-height: 1.5;
      margin: 12px 0;
    }

    .ok {
      color: #7CFF7A;
      font-weight: 700;
    }

    .btn {
      display: block;
      margin: 16px auto 0;
      padding: 16px 18px;
      border-radius: 999px;
      border: 3px solid #111;
      background: #ffda21;
      color: #111;
      font-size: 20px;
      font-weight: 800;
      text-decoration: none;
      box-shadow: 0 8px 0 #000;
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
    <h1>X Connected</h1>
    <p class="ok">@${safeXUsername} connected successfully.</p>
    <p>Opening @${safeOfficialUsername} now.</p>
    <p>Like, repost, and comment on any official post, then manually return to the wallet page to claim.</p>

    <a class="btn" id="openXBtn" href="${safeOfficialAppUrl}">Open official X</a>
    <a class="btn" href="${safeSiteUrl}">Back to claim page</a>

    <p class="small">Wallet: ${safeWallet}</p>
    <p class="small">Fallback: ${safeOfficialWebUrl}</p>
  </div>

  <script>
    (function () {
      var wallet = ${JSON.stringify(walletAddress)};
      var officialAppUrl = ${JSON.stringify(officialAppUrl)};
      var officialWebUrl = ${JSON.stringify(officialWebUrl)};

      try {
        if (wallet) {
          localStorage.setItem("wallet_connected", "true");
          localStorage.setItem("wallet_address", wallet);
          localStorage.setItem("x_connected_" + String(wallet).toLowerCase(), "true");
          localStorage.setItem("pending_official_x", "true");
        }
      } catch (error) {}

      var appOpened = false;

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          appOpened = true;
        }
      }, { once: true });

      setTimeout(function () {
        window.location.href = officialAppUrl;
      }, 500);

      setTimeout(function () {
        if (!appOpened) {
          window.location.href = officialWebUrl;
        }
      }, 2200);
    })();
  </script>
</body>
</html>`);
}

export default async function handler(req, res) {
  try {
    const code = req.query.code;
    const state = req.query.state;

    if (!code || !state) {
      return res.redirect(`${process.env.SITE_URL}/?x_error=missing_oauth_params`);
    }

    const { data: oauthState, error: stateError } = await supabase
      .from("oauth_states")
      .select("*")
      .eq("state", state)
      .maybeSingle();

    if (stateError) {
      throw stateError;
    }

    if (!oauthState) {
      return res.redirect(`${process.env.SITE_URL}/?x_error=oauth_state_not_found`);
    }

    if (new Date(oauthState.expires_at).getTime() < Date.now()) {
      await supabase.from("oauth_states").delete().eq("state", state);
      return res.redirect(`${process.env.SITE_URL}/?x_error=oauth_expired`);
    }

    const client = getOAuthClient();

    const {
      client: loggedClient,
      accessToken,
      refreshToken,
      expiresIn
    } = await client.loginWithOAuth2({
      code,
      codeVerifier: oauthState.code_verifier,
      redirectUri: process.env.X_REDIRECT_URI
    });

    const me = await loggedClient.v2.me();

    const xUserId = me.data.id;
    const xUsername = me.data.username;
    const walletAddress = oauthState.wallet_address.toLowerCase();

    const { data: existingXUser } = await supabase
      .from("users")
      .select("wallet_address")
      .eq("x_user_id", xUserId)
      .maybeSingle();

    if (
      existingXUser &&
      existingXUser.wallet_address &&
      existingXUser.wallet_address.toLowerCase() !== walletAddress
    ) {
      await supabase.from("oauth_states").delete().eq("state", state);
      return res.redirect(`${process.env.SITE_URL}/?x_error=already_bound`);
    }

    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;

    const { error: upsertError } = await supabase.from("users").upsert(
      {
        wallet_address: walletAddress,
        x_user_id: xUserId,
        x_username: xUsername,
        x_access_token: accessToken || null,
        x_refresh_token: refreshToken || null,
        x_token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "wallet_address"
      }
    );

    if (upsertError) {
      throw upsertError;
    }

    await supabase.from("oauth_states").delete().eq("state", state);

    return sendOpenXPage(res, walletAddress, xUsername);
  } catch (err) {
    console.error("X callback error:", err);
    return res.status(500).send("X callback failed");
  }
}

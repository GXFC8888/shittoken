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

function getSiteUrl() {
  return (process.env.SITE_URL || "https://shittoken.us").replace(/\/+$/, "");
}

function buildClaimUrl(walletAddress, xUsername) {
  const siteUrl = getSiteUrl();
  const params = new URLSearchParams();

  params.set("x_connected", "1");

  if (walletAddress) {
    params.set("wallet", walletAddress);
  }

  if (xUsername) {
    params.set("x_username", xUsername);
  }

  return `${siteUrl}/?${params.toString()}`;
}

async function saveUserAuthorization({
  walletAddress,
  xUserId,
  xUsername,
  accessToken,
  refreshToken,
  tokenExpiresAt
}) {
  const payload = {
    wallet_address: walletAddress,
    x_user_id: xUserId,
    x_username: xUsername,
    x_access_token: accessToken || null,
    x_refresh_token: refreshToken || null,
    x_token_expires_at: tokenExpiresAt,
    updated_at: new Date().toISOString()
  };

  const { error: upsertError } = await supabase.from("users").upsert(payload, {
    onConflict: "wallet_address"
  });

  if (!upsertError) {
    return;
  }

  console.error("users upsert failed, trying update/insert fallback:", upsertError);

  const { data: existingUser, error: findError } = await supabase
    .from("users")
    .select("id,wallet_address")
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (existingUser) {
    const { error: updateError } = await supabase
      .from("users")
      .update(payload)
      .eq("wallet_address", walletAddress);

    if (updateError) {
      throw updateError;
    }

    return;
  }

  const insertPayload = {
    ...payload,
    created_at: new Date().toISOString()
  };

  const { error: insertError } = await supabase
    .from("users")
    .insert(insertPayload);

  if (insertError) {
    throw insertError;
  }
}

function sendConnectedAndOpenXPage(res, walletAddress, xUsername) {
  const officialUsername = String(OFFICIAL_X_USERNAME).replace("@", "");
  const officialWebUrl = `https://x.com/${officialUsername}`;
  const twitterAppUrl = `twitter://user?screen_name=${officialUsername}`;
  const xAppUrl = `x://user?screen_name=${officialUsername}`;
  const claimUrl = buildClaimUrl(walletAddress, xUsername);

  const safeWallet = escapeHtml(walletAddress);
  const safeXUsername = escapeHtml(xUsername);
  const safeOfficialUsername = escapeHtml(officialUsername);
  const safeOfficialWebUrl = escapeHtml(officialWebUrl);
  const safeTwitterAppUrl = escapeHtml(twitterAppUrl);
  const safeClaimUrl = escapeHtml(claimUrl);

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

    .btn.light {
      background: #fff5bc;
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
    <p>Like, repost, and comment on the latest official post, then manually return to the wallet page to claim.</p>

    <a class="btn" id="openXBtn" href="${safeTwitterAppUrl}">Open official X</a>
    <a class="btn light" id="backBtn" href="${safeClaimUrl}">Back to claim page</a>

    <p class="small">Wallet: ${safeWallet}</p>
    <p class="small">Official X: ${safeOfficialWebUrl}</p>
  </div>

  <script>
    (function () {
      var wallet = ${JSON.stringify(walletAddress)};
      var xUsername = ${JSON.stringify(xUsername)};
      var claimUrl = ${JSON.stringify(claimUrl)};
      var officialWebUrl = ${JSON.stringify(officialWebUrl)};
      var twitterAppUrl = ${JSON.stringify(twitterAppUrl)};
      var xAppUrl = ${JSON.stringify(xAppUrl)};

      try {
        if (wallet) {
          localStorage.setItem("wallet_connected", "true");
          localStorage.setItem("wallet_address", wallet);
          localStorage.setItem("pending_x_wallet", wallet);
          localStorage.setItem("x_connected_" + String(wallet).toLowerCase(), "true");
          localStorage.setItem("pending_official_x", "true");
        }

        if (xUsername) {
          localStorage.setItem("x_username", xUsername);
        }
      } catch (error) {}

      var userAgent = navigator.userAgent || "";
      var isIOS = /iPhone|iPad|iPod/i.test(userAgent);
      var appOpened = false;

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          appOpened = true;
        }
      }, { once: true });

      window.addEventListener("pagehide", function () {
        appOpened = true;
      }, { once: true });

      if (isIOS) {
        setTimeout(function () {
          window.location.href = xAppUrl;
        }, 900);

        setTimeout(function () {
          if (!appOpened) {
            window.location.href = twitterAppUrl;
          }
        }, 1700);

        setTimeout(function () {
          if (!appOpened) {
            window.location.href = officialWebUrl;
          }
        }, 4200);

        return;
      }

      setTimeout(function () {
        window.location.href = twitterAppUrl;
      }, 900);

      setTimeout(function () {
        if (!appOpened) {
          window.location.href = officialWebUrl;
        }
      }, 2600);
    })();
  </script>
</body>
</html>`);
}

export default async function handler(req, res) {
  try {
    const code = req.query.code;
    const state = req.query.state;
    const siteUrl = getSiteUrl();

    if (!code || !state) {
      return res.redirect(`${siteUrl}/?x_error=missing_oauth_params`);
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
      return res.redirect(`${siteUrl}/?x_error=oauth_state_not_found`);
    }

    if (new Date(oauthState.expires_at).getTime() < Date.now()) {
      await supabase.from("oauth_states").delete().eq("state", state);
      return res.redirect(`${siteUrl}/?x_error=oauth_expired`);
    }

    const rawWalletAddress = oauthState.wallet_address;

    if (!rawWalletAddress) {
      await supabase.from("oauth_states").delete().eq("state", state);
      return res.redirect(`${siteUrl}/?x_error=missing_wallet`);
    }

    const walletAddress = String(rawWalletAddress).toLowerCase();

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

    if (!accessToken) {
      throw new Error("Missing X access token");
    }

    const me = await loggedClient.v2.me();

    if (!me || !me.data || !me.data.id || !me.data.username) {
      throw new Error("Failed to read X user profile");
    }

    const xUserId = String(me.data.id);
    const xUsername = String(me.data.username);

    const { data: existingXUser, error: existingXUserError } = await supabase
      .from("users")
      .select("wallet_address")
      .eq("x_user_id", xUserId)
      .maybeSingle();

    if (existingXUserError) {
      throw existingXUserError;
    }

    if (
      existingXUser &&
      existingXUser.wallet_address &&
      existingXUser.wallet_address.toLowerCase() !== walletAddress
    ) {
      await supabase.from("oauth_states").delete().eq("state", state);
      return res.redirect(`${siteUrl}/?x_error=already_bound`);
    }

    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;

    await saveUserAuthorization({
      walletAddress,
      xUserId,
      xUsername,
      accessToken,
      refreshToken,
      tokenExpiresAt
    });

    const { data: savedUser, error: savedUserError } = await supabase
      .from("users")
      .select("wallet_address,x_user_id,x_username,x_access_token,x_refresh_token,x_token_expires_at")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (savedUserError) {
      throw savedUserError;
    }

    if (!savedUser || !savedUser.x_access_token) {
      throw new Error("X authorization was not saved to users table");
    }

    await supabase.from("oauth_states").delete().eq("state", state);

    console.log("X connected successfully:", {
      walletAddress,
      xUserId,
      xUsername,
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken)
    });

    return sendConnectedAndOpenXPage(res, walletAddress, xUsername);
  } catch (err) {
    console.error("X callback error:", err);
    return res.status(500).send("X callback failed");
  }
}

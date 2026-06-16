import crypto from "crypto";
import { supabase } from "../../../lib/supabase.js";

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCodeVerifier() {
  return base64Url(crypto.randomBytes(64));
}

function createCodeChallenge(codeVerifier) {
  return base64Url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
}

function createState() {
  return base64Url(crypto.randomBytes(32));
}

function buildXAuthUrl({ state, codeChallenge }) {
  const redirectUri = process.env.X_REDIRECT_URI;
  const clientId = process.env.X_CLIENT_ID;

  if (!redirectUri) {
    throw new Error("Missing X_REDIRECT_URI");
  }

  if (!clientId) {
    throw new Error("Missing X_CLIENT_ID");
  }

  const params = new URLSearchParams();

  params.set("response_type", "code");
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri);
  params.set("state", state);
  params.set("code_challenge", codeChallenge);
  params.set("code_challenge_method", "S256");

  // Minimum scope test version.
  // Do not use like.read or offline.access here first.
  params.set("scope", "tweet.read users.read");

  // Force X to show the authorization page again.
  params.set("prompt", "consent");

  return `https://x.com/i/oauth2/authorize?${params
    .toString()
    .replace(/\+/g, "%20")}`;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    const wallet = String(req.query.wallet || "").toLowerCase();

    if (!wallet || !wallet.startsWith("0x")) {
      return res.status(400).json({ error: "Missing wallet address" });
    }

    const state = createState();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

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

    const authUrl = buildXAuthUrl({
      state,
      codeChallenge
    });

    return res.redirect(302, authUrl);
  } catch (err) {
    console.error("X login error:", err);
    return res.status(500).json({ error: "X login failed" });
  }
}

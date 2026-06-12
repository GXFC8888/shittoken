import { parse, serialize } from "cookie";
import { getOAuthClient } from "../../../lib/x.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const cookies = parse(req.headers.cookie || "");

    const code = req.query.code;
    const state = req.query.state;

    const savedState = cookies.x_state;
    const codeVerifier = cookies.x_code_verifier;
    const wallet = cookies.airdrop_wallet;

    if (!code || !state || !savedState || !codeVerifier || !wallet) {
      return res.status(400).send("Missing OAuth data");
    }

    if (state !== savedState) {
      return res.status(400).send("Invalid OAuth state");
    }

    const client = getOAuthClient();

    const { client: loggedClient } = await client.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: process.env.X_REDIRECT_URI
    });

    const me = await loggedClient.v2.me();

    const xUserId = me.data.id;
    const xUsername = me.data.username;
    const walletAddress = wallet.toLowerCase();

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
      return res.redirect(`${process.env.SITE_URL}/?x_error=already_bound`);
    }

    await supabase.from("users").upsert(
      {
        wallet_address: walletAddress,
        x_user_id: xUserId,
        x_username: xUsername,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "wallet_address"
      }
    );

    res.setHeader("Set-Cookie", [
      serialize("x_code_verifier", "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0
      }),
      serialize("x_state", "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0
      }),
      serialize("airdrop_wallet", "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0
      })
    ]);

    return res.redirect(`${process.env.SITE_URL}/?x_connected=1`);
  } catch (err) {
    console.error("X callback error:", err);
    return res.status(500).send("X callback failed");
  }
}

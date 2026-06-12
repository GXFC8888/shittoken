import { getOAuthClient } from "../../../lib/x.js";
import { supabase } from "../../../lib/supabase.js";

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

    const { client: loggedClient } = await client.loginWithOAuth2({
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

    const { error: upsertError } = await supabase.from("users").upsert(
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

    if (upsertError) {
      throw upsertError;
    }

    await supabase.from("oauth_states").delete().eq("state", state);

    return res.redirect(`${process.env.SITE_URL}/?x_connected=1`);
  } catch (err) {
    console.error("X callback error:", err);
    return res.status(500).send("X callback failed");
  }
}

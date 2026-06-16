import { TwitterApi } from "twitter-api-v2";

export function getOAuthClient() {
  return new TwitterApi({
    clientId: process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET
  });
}

export function getAppClient() {
  return new TwitterApi(process.env.X_BEARER_TOKEN);
}

import { supabase } from "../lib/supabase.js";

const X_API_BASE = "https://api.x.com/2";
const OFFICIAL_USERNAME = process.env.X_OFFICIAL_USERNAME || "GXFCLJ";
const MAX_OFFICIAL_POSTS = 1;
const MAX_OFFICIAL_POST_PAGES = 1;

function getBearerToken() {
  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;

  if (!token) {
    throw new Error("Missing X_BEARER_TOKEN");
  }

  return token;
}

async function xGet(path, params = {}, token = null) {
  const url = new URL(`${X_API_BASE}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token || getBearerToken()}`
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.detail ||
      data.title ||
      data.error ||
      data.errors?.[0]?.message ||
      `X API request failed: ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function getOfficialUser() {
  const username = String(OFFICIAL_USERNAME).replace("@", "");

  const data = await xGet(`/users/by/username/${username}`, {
    "user.fields": "id,username"
  });

  if (!data.data || !data.data.id) {
    throw new Error("Official X account not found");
  }

  return data.data;
}

async function getOfficialTweets(officialUserId) {
  const tweets = [];
  let paginationToken = null;
  let page = 0;

  while (tweets.length < MAX_OFFICIAL_POSTS && page < MAX_OFFICIAL_POST_PAGES) {
    page += 1;

    const params = {
      max_results: 100,
      exclude: "retweets,replies",
      "tweet.fields": "id,text,created_at,author_id"
    };

    if (paginationToken) {
      params.pagination_token = paginationToken;
    }

    const data = await xGet(`/users/${officialUserId}/tweets`, params);
    const pageTweets = data.data || [];

    tweets.push(...pageTweets);

    paginationToken = data.meta && data.meta.next_token;

    if (!paginationToken) {
      break;
    }
  }

  return tweets.slice(0, MAX_OFFICIAL_POSTS);
}

async function ensureTaskForTweet(tweet) {
  const tweetId = String(tweet.id);

  const { data: existingTask, error: existingError } = await supabase
    .from("tasks")
    .select("*")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingTask) {
    return existingTask;
  }

  const title = `Official Post ${tweetId.slice(-6)}`;

  const { data: insertedTask, error: insertError } = await supabase
    .from("tasks")
    .insert({
      title,
      tweet_id: tweetId,
      reward_amount: "1",
      active: true
    })
    .select()
    .maybeSingle();

  if (insertError) {
    const { data: fallbackTask, error: fallbackError } = await supabase
      .from("tasks")
      .select("*")
      .eq("tweet_id", tweetId)
      .maybeSingle();

    if (fallbackError) {
      throw fallbackError;
    }

    if (fallbackTask) {
      return fallbackTask;
    }

    throw insertError;
  }

  return insertedTask;
}

async function getClaimedTweetIds(wallet) {
  const { data, error } = await supabase
    .from("task_progress")
    .select("tweet_id")
    .eq("wallet_address", wallet)
    .eq("claimed", true)
    .not("tweet_id", "is", null);

  if (error) {
    throw error;
  }

  return new Set((data || []).map((row) => String(row.tweet_id)));
}

async function findUserInPaginatedUsers(path, tweetId, xUserId) {
  let paginationToken = null;
  let page = 0;
  const maxPages = 10;

  while (page < maxPages) {
    page += 1;

    const params = {
      max_results: 100,
      "user.fields": "id,username"
    };

    if (paginationToken) {
      params.pagination_token = paginationToken;
    }

    const data = await xGet(path.replace(":tweetId", tweetId), params);
    const users = data.data || [];

    if (users.some((user) => String(user.id) === String(xUserId))) {
      return true;
    }

    paginationToken = data.meta && data.meta.next_token;

    if (!paginationToken) {
      break;
    }
  }

  return false;
}

async function findTweetInUserLikedTweets(tweetId, xUserId, accessToken) {
  if (!accessToken) {
    return false;
  }

  let paginationToken = null;
  let page = 0;
  const maxPages = 10;

  while (page < maxPages) {
    page += 1;

    const params = {
      max_results: 100,
      "tweet.fields": "id,created_at"
    };

    if (paginationToken) {
      params.pagination_token = paginationToken;
    }

    const data = await xGet(`/users/${xUserId}/liked_tweets`, params, accessToken);
    const tweets = data.data || [];

    if (tweets.some((tweet) => String(tweet.id) === String(tweetId))) {
      return true;
    }

    paginationToken = data.meta && data.meta.next_token;

    if (!paginationToken) {
      break;
    }
  }

  return false;
}

async function safeCheck(name, checkFn) {
  try {
    const result = await checkFn();

    return {
      ok: Boolean(result),
      error: null
    };
  } catch (error) {
    console.warn(`${name} check failed:`, error.message || String(error));

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

async function hasLiked(tweetId, xUserId, accessToken) {
  const likedFromUserToken = await findTweetInUserLikedTweets(
    tweetId,
    xUserId,
    accessToken
  );

  if (likedFromUserToken) {
    return true;
  }

  const likedFromTweet = await findUserInPaginatedUsers(
    "/tweets/:tweetId/liking_users",
    tweetId,
    xUserId
  );

  return Boolean(likedFromTweet);
}

async function hasReposted(tweetId, xUserId) {
  return findUserInPaginatedUsers(
    "/tweets/:tweetId/retweeted_by",
    tweetId,
    xUserId
  );
}

async function hasCommented(tweetId, xUserId, xUsername) {
  let paginationToken = null;
  let page = 0;
  const maxPages = 10;

  const query = `conversation_id:${tweetId} from:${xUsername} -is:retweet`;

  while (page < maxPages) {
    page += 1;

    const params = {
      query,
      max_results: 100,
      "tweet.fields": "author_id,conversation_id,created_at"
    };

    if (paginationToken) {
      params.pagination_token = paginationToken;
    }

    const data = await xGet("/tweets/search/recent", params);
    const tweets = data.data || [];

    const found = tweets.some((tweet) => {
      return (
        String(tweet.author_id) === String(xUserId) &&
        String(tweet.conversation_id) === String(tweetId)
      );
    });

    if (found) {
      return true;
    }

    paginationToken = data.meta && data.meta.next_token;

    if (!paginationToken) {
      break;
    }
  }

  return false;
}

async function saveProgress(payload) {
  const { data: existingProgress, error: findError } = await supabase
    .from("task_progress")
    .select("*")
    .eq("wallet_address", payload.wallet_address)
    .eq("tweet_id", payload.tweet_id)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (existingProgress) {
    const { data: updatedProgress, error: updateError } = await supabase
      .from("task_progress")
      .update(payload)
      .eq("id", existingProgress.id)
      .select()
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    return updatedProgress;
  }

  const { data: insertedProgress, error: insertError } = await supabase
    .from("task_progress")
    .insert(payload)
    .select()
    .maybeSingle();

  if (insertError) {
    throw insertError;
  }

  return insertedProgress;
}

async function checkTweetActions({ tweet, xUserId, xUsername, accessToken }) {
  const tweetId = String(tweet.id);

  const [likedResult, repostedResult, commentedResult] = await Promise.all([
    safeCheck("liked", () => hasLiked(tweetId, xUserId, accessToken)),
    safeCheck("reposted", () => hasReposted(tweetId, xUserId)),
    safeCheck("commented", () => hasCommented(tweetId, xUserId, xUsername))
  ]);

  const liked = likedResult.ok;
  const reposted = repostedResult.ok;
  const commented = commentedResult.ok;
  const completed = Boolean(liked && reposted && commented);
  const score = Number(liked) + Number(reposted) + Number(commented);

  return {
    tweet,
    tweetId,
    liked,
    reposted,
    commented,
    completed,
    score,
    actionErrors: {
      liked: likedResult.error,
      reposted: repostedResult.error,
      commented: commentedResult.error
    }
  };
}

async function saveResultProgress({ result, task, wallet, xUserId, xUsername }) {
  const now = new Date().toISOString();

  const progressPayload = {
    task_id: task.id,
    tweet_id: result.tweetId,
    wallet_address: wallet,
    x_user_id: xUserId,
    x_username: xUsername,
    liked: result.liked,
    reposted: result.reposted,
    commented: result.commented,
    verified: result.completed,
    claimable: result.completed,
    verified_at: result.completed ? now : null
  };

  return saveProgress(progressPayload);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const wallet = String(req.body.wallet || "").toLowerCase();

    if (!wallet || !wallet.startsWith("0x")) {
      return res.status(400).json({
        success: false,
        error: "Missing wallet address"
      });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("wallet_address, x_user_id, x_username, x_access_token")
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (userError) {
      throw userError;
    }

    if (!user || !user.x_user_id || !user.x_username || !user.x_access_token) {
      return res.status(400).json({
        success: false,
        error: "Please connect X first"
      });
    }

    const officialUser = await getOfficialUser();
    const officialTweets = await getOfficialTweets(officialUser.id);
    const claimedTweetIds = await getClaimedTweetIds(wallet);

    if (!officialTweets.length) {
      return res.status(200).json({
        success: false,
        completed: false,
        claimable: false,
        message: "No official post found."
      });
    }

    const latestTweet = officialTweets[0];
    const latestTweetId = String(latestTweet.id);

    if (claimedTweetIds.has(latestTweetId)) {
      return res.status(200).json({
        success: false,
        completed: false,
        claimable: false,
        message: "Latest official post already claimed."
      });
    }

    const xUserId = String(user.x_user_id);
    const xUsername = String(user.x_username).replace("@", "");
    const accessToken = user.x_access_token;

    const result = await checkTweetActions({
      tweet: latestTweet,
      xUserId,
      xUsername,
      accessToken
    });

    const task = await ensureTaskForTweet(latestTweet);
    const progress = await saveResultProgress({
      result,
      task,
      wallet,
      xUserId,
      xUsername
    });

    if (!result.completed) {
      return res.status(200).json({
        success: false,
        completed: false,
        claimable: false,
        message: "Latest official post is not completed yet. Please like, repost, and comment on the latest official post, then try again.",
        latestTweetId,
        liked: result.liked,
        reposted: result.reposted,
        commented: result.commented,
        progress,
        actionErrors: result.actionErrors
      });
    }

    return res.status(200).json({
      success: true,
      completed: true,
      claimable: true,
      tweetId: result.tweetId,
      taskId: task.id,
      liked: result.liked,
      reposted: result.reposted,
      commented: result.commented,
      message: "Latest official post verified. You can claim now.",
      progress
    });
  } catch (error) {
    console.error("Verify error:", error);

    return res.status(500).json({
      success: false,
      error: "Verification failed",
      detail: error.message || String(error)
    });
  }
}

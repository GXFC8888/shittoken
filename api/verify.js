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
    throw new Error(
      data?.detail ||
      data?.title ||
      data?.error ||
      `X API error: ${response.status}`
    );
  }

  return data;
}

/* ----------------------------
   OFFICIAL USER + POSTS
----------------------------- */

async function getOfficialUser() {
  const username = String(OFFICIAL_USERNAME).replace("@", "");

  const data = await xGet(`/users/by/username/${username}`, {
    "user.fields": "id,username"
  });

  if (!data?.data?.id) {
    throw new Error("Official X account not found");
  }

  return data.data;
}

async function getOfficialTweets(officialUserId) {
  const tweets = [];

  const data = await xGet(`/users/${officialUserId}/tweets`, {
    max_results: 10,
    exclude: "retweets,replies",
    "tweet.fields": "id,text,created_at"
  });

  if (data?.data) {
    tweets.push(...data.data);
  }

  return tweets.slice(0, MAX_OFFICIAL_POSTS);
}

/* ----------------------------
   TASK / DB
----------------------------- */

async function ensureTaskForTweet(tweet) {
  const tweetId = String(tweet.id);

  const { data: existingTask } = await supabase
    .from("tasks")
    .select("*")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (existingTask) return existingTask;

  const { data: inserted } = await supabase
    .from("tasks")
    .insert({
      title: `Official Post ${tweetId.slice(-6)}`,
      tweet_id: tweetId,
      reward_amount: "1",
      active: true
    })
    .select()
    .maybeSingle();

  return inserted;
}

async function getClaimedTweetIds(wallet) {
  const { data } = await supabase
    .from("task_progress")
    .select("tweet_id")
    .eq("wallet_address", wallet)
    .eq("claimed", true);

  return new Set((data || []).map(r => String(r.tweet_id)));
}

/* ----------------------------
   ACTION CHECKS
----------------------------- */

/**
 * ❗ FOLLOW（已修复：不再使用分页旧逻辑）
 * 直接判断是否关注官方账号
 */
async function hasFollowedOfficial(xUserId, officialUserId, accessToken) {
  try {
    const data = await xGet(
      `/users/${xUserId}/following/${officialUserId}`,
      {},
      accessToken
    );

    return Boolean(data && data.data);
  } catch (e) {
    return false;
  }
}

async function hasLiked(tweetId, xUserId, accessToken) {
  try {
    const data = await xGet(
      `/users/${xUserId}/liked_tweets`,
      { max_results: 50 },
      accessToken
    );

    return (data?.data || []).some(t => String(t.id) === String(tweetId));
  } catch {
    return false;
  }
}

async function hasReposted(tweetId, xUserId) {
  try {
    const data = await xGet(`/tweets/${tweetId}/retweeted_by`);
    return (data?.data || []).some(u => String(u.id) === String(xUserId));
  } catch {
    return false;
  }
}

async function hasCommented(tweetId, xUserId, xUsername) {
  try {
    const data = await xGet("/tweets/search/recent", {
      query: `conversation_id:${tweetId} from:${xUsername}`
    });

    return (data?.data || []).length > 0;
  } catch {
    return false;
  }
}

/* ----------------------------
   CORE VERIFY LOGIC
----------------------------- */

async function checkTweetActions({
  tweet,
  officialUserId,
  xUserId,
  xUsername,
  accessToken
}) {
  const tweetId = String(tweet.id);

  const followed = await hasFollowedOfficial(
    xUserId,
    officialUserId,
    accessToken
  );

  const liked = await hasLiked(tweetId, xUserId, accessToken);
  const reposted = await hasReposted(tweetId, xUserId);
  const commented = await hasCommented(tweetId, xUserId, xUsername);

  const completed = Boolean(
    followed && liked && reposted && commented
  );

  return {
    tweet,
    tweetId,
    followed,
    liked,
    reposted,
    commented,
    completed
  };
}

/* ----------------------------
   SAVE PROGRESS
----------------------------- */

async function saveProgress(payload) {
  const { data: existing } = await supabase
    .from("task_progress")
    .select("*")
    .eq("wallet_address", payload.wallet_address)
    .eq("tweet_id", payload.tweet_id)
    .maybeSingle();

  if (existing) {
    return supabase
      .from("task_progress")
      .update(payload)
      .eq("id", existing.id);
  }

  return supabase.from("task_progress").insert(payload);
}

/* ----------------------------
   API HANDLER
----------------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false });
  }

  try {
    const wallet = String(req.body.wallet || "").toLowerCase();

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "No X account connected"
      });
    }

    const officialUser = await getOfficialUser();
    const tweets = await getOfficialTweets(officialUser.id);

    if (!tweets.length) {
      return res.json({
        success: false,
        message: "No tweet found"
      });
    }

    const latestTweet = tweets[0];
    const tweetId = String(latestTweet.id);

    const claimed = await getClaimedTweetIds(wallet);

    if (claimed.has(tweetId)) {
      return res.json({
        success: false,
        lockClaim: true,
        message: "Already claimed"
      });
    }

    const result = await checkTweetActions({
      tweet: latestTweet,
      officialUserId: officialUser.id,
      xUserId: user.x_user_id,
      xUsername: user.x_username.replace("@", ""),
      accessToken: user.x_access_token
    });

    const task = await ensureTaskForTweet(latestTweet);

    await saveProgress({
      task_id: task.id,
      tweet_id: tweetId,
      wallet_address: wallet,
      x_user_id: user.x_user_id,
      x_username: user.x_username,
      followed: result.followed,
      liked: result.liked,
      reposted: result.reposted,
      commented: result.commented,
      verified: result.completed,
      claimable: result.completed
    });

    return res.json({
      success: result.completed,
      completed: result.completed,
      followed: result.followed,
      liked: result.liked,
      reposted: result.reposted,
      commented: result.commented,
      tweetId,
      taskId: task?.id
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

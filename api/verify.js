import { supabase } from "../lib/supabase.js";

const X_API_BASE = "https://api.x.com/2";
const OFFICIAL_USERNAME = process.env.X_OFFICIAL_USERNAME || "GXFCLJ";

function getBearerToken() {
  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
  if (!token) throw new Error("Missing X_BEARER_TOKEN");
  return token;
}

async function xGet(path, params = {}, token = null) {
  const url = new URL(`${X_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token || getBearerToken()}` }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.title || data?.error || "X API error");
  return data;
}

async function getOfficialUser() {
  const username = String(OFFICIAL_USERNAME).replace("@", "");
  const data = await xGet(`/users/by/username/${username}`, {
    "user.fields": "id,username"
  });
  if (!data?.data?.id) throw new Error("Official user not found");
  return data.data;
}

async function getOfficialTweets(userId) {
  const data = await xGet(`/users/${userId}/tweets`, {
    max_results: 10,
    exclude: "retweets,replies",
    "tweet.fields": "id"
  });
  return (data.data || []).slice(0, 1);
}

async function ensureTask(tweet) {
  const tweetId = String(tweet.id);

  const { data: exist } = await supabase
    .from("tasks")
    .select("*")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (exist) return exist;

  const { data } = await supabase
    .from("tasks")
    .insert({
      title: `Official ${tweetId.slice(-6)}`,
      tweet_id: tweetId,
      reward_amount: "1",
      active: true
    })
    .select()
    .maybeSingle();

  return data;
}

async function getClaimed(wallet) {
  const { data } = await supabase
    .from("task_progress")
    .select("tweet_id")
    .eq("wallet_address", wallet)
    .eq("claimed", true);

  return new Set((data || []).map(i => String(i.tweet_id)));
}

async function hasFollowed(xUserId, officialId, token) {
  try {
    const data = await xGet(
      `/users/${xUserId}/following`,
      { max_results: 100 },
      token
    );

    return (data.data || []).some(u => String(u.id) === String(officialId));
  } catch {
    return false;
  }
}

async function hasLiked(tweetId, xUserId, token) {
  try {
    const data = await xGet(
      `/users/${xUserId}/liked_tweets`,
      { max_results: 100 },
      token
    );
    return (data.data || []).some(t => String(t.id) === String(tweetId));
  } catch {
    return false;
  }
}

async function hasReposted(tweetId, xUserId) {
  try {
    const data = await xGet(`/tweets/${tweetId}/retweeted_by`);
    return (data.data || []).some(u => String(u.id) === String(xUserId));
  } catch {
    return false;
  }
}

async function hasCommented(tweetId, xUserId, xUsername) {
  try {
    const data = await xGet("/tweets/search/recent", {
      query: `conversation_id:${tweetId} from:${xUsername}`
    });

    return (data.data || []).length > 0;
  } catch {
    return false;
  }
}

async function check(tweet, officialId, xUserId, xUsername, token) {
  const id = String(tweet.id);

  const [f, l, r, c] = await Promise.all([
    hasFollowed(xUserId, officialId, token),
    hasLiked(id, xUserId, token),
    hasReposted(id, xUserId),
    hasCommented(id, xUserId, xUsername)
  ]);

  return {
    tweet,
    tweetId: id,
    followed: f,
    liked: l,
    reposted: r,
    commented: c,
    completed: f && l && r && c
  };
}

async function save(payload) {
  const { data: exist } = await supabase
    .from("task_progress")
    .select("*")
    .eq("wallet_address", payload.wallet_address)
    .eq("tweet_id", payload.tweet_id)
    .maybeSingle();

  if (exist) {
    return supabase
      .from("task_progress")
      .update(payload)
      .eq("id", exist.id);
  }

  return supabase.from("task_progress").insert(payload);
}

export default async function handler(req, res) {
  try {
    const wallet = String(req.body.wallet || "").toLowerCase();

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (!user?.x_user_id) {
      return res.status(400).json({ success: false });
    }

    const official = await getOfficialUser();
    const tweets = await getOfficialTweets(official.id);

    if (!tweets.length) {
      return res.json({ success: false });
    }

    const tweet = tweets[0];
    const tweetId = String(tweet.id);

    const claimed = await getClaimed(wallet);
    if (claimed.has(tweetId)) {
      return res.json({ success: false, lockClaim: true });
    }

    const result = await check(
      tweet,
      official.id,
      user.x_user_id,
      user.x_username,
      user.x_access_token
    );

    const task = await ensureTask(tweet);

    await save({
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
      ...result,
      taskId: task?.id
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message
    });
  }
}

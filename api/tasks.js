import { supabase } from "../lib/supabase.js";

const X_API_BASE = "https://api.x.com/2";
const OFFICIAL_USERNAME = process.env.X_OFFICIAL_USERNAME || "GXFCLJ";

function getBearerToken() {
  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;

  if (!token) {
    throw new Error("Missing X_BEARER_TOKEN");
  }

  return token;
}

async function xGet(path, params = {}) {
  const url = new URL(`${X_API_BASE}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBearerToken()}`
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("X API error:", {
      path,
      status: res.status,
      data
    });

    throw new Error(
      data?.detail ||
        data?.title ||
        data?.error ||
        data?.message ||
        "X API error"
    );
  }

  return data;
}

async function getOfficialUser() {
  const username = String(OFFICIAL_USERNAME).replace("@", "");

  const data = await xGet(`/users/by/username/${username}`, {
    "user.fields": "id,username"
  });

  if (!data?.data?.id) {
    throw new Error("Official user not found");
  }

  return data.data;
}

async function getLatestOfficialTweet() {
  const official = await getOfficialUser();

  const data = await xGet(`/users/${official.id}/tweets`, {
    max_results: 5,
    exclude: "retweets,replies",
    "tweet.fields": "id,created_at"
  });

  const tweets = data.data || [];

  if (!tweets.length) {
    return null;
  }

  return tweets[0];
}

async function ensureLatestTask() {
  const latestTweet = await getLatestOfficialTweet();

  if (!latestTweet?.id) {
    const { data: currentTask, error: currentError } = await supabase
      .from("tasks")
      .select("*")
      .eq("active", true)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentError) {
      throw currentError;
    }

    return currentTask || null;
  }

  const tweetId = String(latestTweet.id);

  const { data: existingTask, error: existingError } = await supabase
    .from("tasks")
    .select("*")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingTask) {
    if (!existingTask.active) {
      await supabase
        .from("tasks")
        .update({ active: false })
        .neq("id", existingTask.id);

      const { data: activatedTask, error: activateError } = await supabase
        .from("tasks")
        .update({
          active: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", existingTask.id)
        .select()
        .maybeSingle();

      if (activateError) {
        throw activateError;
      }

      return activatedTask;
    }

    await supabase
      .from("tasks")
      .update({ active: false })
      .neq("id", existingTask.id);

    return existingTask;
  }

  await supabase
    .from("tasks")
    .update({ active: false })
    .eq("active", true);

  const title = `Official ${tweetId.slice(-6)}`;

  const { data: newTask, error: insertError } = await supabase
    .from("tasks")
    .insert({
      title,
      tweet_id: tweetId,
      reward_amount: "1",
      active: true,
      created_at: new Date().toISOString()
    })
    .select()
    .maybeSingle();

  if (insertError) {
    throw insertError;
  }

  return newTask;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const wallet = String(req.query.wallet || "").toLowerCase();

    const latestTask = await ensureLatestTask();

    let progress = [];
    let xAccount = null;

    if (wallet && wallet.startsWith("0x")) {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("x_user_id, x_username")
        .eq("wallet_address", wallet)
        .maybeSingle();

      if (userError) {
        throw userError;
      }

      xAccount = userData || null;

      if (latestTask) {
        const { data: progressData, error: progressError } = await supabase
          .from("task_progress")
          .select("*")
          .eq("wallet_address", wallet)
          .eq("task_id", latestTask.id);

        if (progressError) {
          throw progressError;
        }

        progress = progressData || [];
      }
    }

    return res.status(200).json({
      success: true,
      tasks: latestTask ? [latestTask] : [],
      progress,
      latestTaskId: latestTask ? latestTask.id : null,
      latestTweetId: latestTask ? String(latestTask.tweet_id) : null,
      xConnected: Boolean(xAccount && xAccount.x_user_id),
      xUsername: xAccount ? xAccount.x_username : null
    });
  } catch (err) {
    console.error("Tasks error:", err);

    return res.status(500).json({
      success: false,
      error: "Failed to load tasks",
      detail: err.message
    });
  }
}

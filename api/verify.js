import { supabase } from "../lib/supabase.js";

const X_API_BASE = "https://api.x.com/2";

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

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBearerToken()}`
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

async function findUserInPaginatedUsers(path, tweetId, xUserId) {
  let paginationToken = null;
  let page = 0;
  const maxPages = 10;

  while (page < maxPages) {
    page += 1;

    const data = await xGet(path.replace(":tweetId", tweetId), {
      max_results: 100,
      "user.fields": "id,username",
      pagination_token: paginationToken
    });

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

async function hasLiked(tweetId, xUserId) {
  return findUserInPaginatedUsers(
    "/tweets/:tweetId/liking_users",
    tweetId,
    xUserId
  );
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

    const data = await xGet("/tweets/search/recent", {
      query,
      max_results: 100,
      "tweet.fields": "author_id,conversation_id,created_at",
      pagination_token: paginationToken
    });

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const wallet = String(req.body.wallet || "").toLowerCase();
    const taskId = Number(req.body.taskId);

    if (!wallet || !wallet.startsWith("0x")) {
      return res.status(400).json({
        success: false,
        error: "Missing wallet address"
      });
    }

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: "Missing task ID"
      });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("wallet_address, x_user_id, x_username")
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (userError) {
      throw userError;
    }

    if (!user || !user.x_user_id || !user.x_username) {
      return res.status(400).json({
        success: false,
        error: "Please connect X first"
      });
    }

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("active", true)
      .maybeSingle();

    if (taskError) {
      throw taskError;
    }

    if (!task || !task.tweet_id) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    const tweetId = String(task.tweet_id);
    const xUserId = String(user.x_user_id);
    const xUsername = String(user.x_username).replace("@", "");

    const [liked, reposted, commented] = await Promise.all([
      hasLiked(tweetId, xUserId),
      hasReposted(tweetId, xUserId),
      hasCommented(tweetId, xUserId, xUsername)
    ]);

    const completed = Boolean(liked && reposted && commented);
    const now = new Date().toISOString();

    const updateData = {
      task_id: taskId,
      wallet_address: wallet,
      x_user_id: xUserId,
      x_username: xUsername,
      liked,
      reposted,
      commented,
      verified: completed,
      claimable: completed,
      verified_at: completed ? now : null
    };

    const { data: savedProgress, error: progressError } = await supabase
      .from("task_progress")
      .upsert(updateData, {
        onConflict: "task_id,wallet_address"
      })
      .select()
      .maybeSingle();

    if (progressError) {
      throw progressError;
    }

    if (!completed) {
      return res.status(200).json({
        success: false,
        completed: false,
        claimable: false,
        liked,
        reposted,
        commented,
        message: "Mission not completed yet. Please like, repost, and comment, then try again.",
        progress: savedProgress
      });
    }

    return res.status(200).json({
      success: true,
      completed: true,
      claimable: true,
      liked,
      reposted,
      commented,
      message: "Mission verified. You can claim now.",
      progress: savedProgress
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

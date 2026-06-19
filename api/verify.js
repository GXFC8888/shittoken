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

async function xGet(path, params = {}, token = null) {
  const url = new URL(`${X_API_BASE}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token || getBearerToken()}`
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

async function getLatestActiveTask() {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("active", true)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function getTaskById(taskId) {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function getUserByWallet(wallet) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function hasFollowed(xUserId, officialId, token) {
  try {
    const data = await xGet(
      `/users/${xUserId}/following`,
      {
        max_results: 100
      },
      token
    );

    return (data.data || []).some((user) => {
      return String(user.id) === String(officialId);
    });
  } catch (error) {
    console.error("Follow check failed:", error.message);
    return false;
  }
}

async function hasLiked(tweetId, xUserId, token) {
  try {
    const data = await xGet(
      `/users/${xUserId}/liked_tweets`,
      {
        max_results: 100,
        "tweet.fields": "id"
      },
      token
    );

    return (data.data || []).some((tweet) => {
      return String(tweet.id) === String(tweetId);
    });
  } catch (error) {
    console.error("Like check failed:", error.message);
    return false;
  }
}

async function hasReposted(tweetId, xUserId) {
  try {
    const data = await xGet(`/tweets/${tweetId}/retweeted_by`, {
      max_results: 100
    });

    return (data.data || []).some((user) => {
      return String(user.id) === String(xUserId);
    });
  } catch (error) {
    console.error("Repost check failed:", error.message);
    return false;
  }
}

async function hasCommented(tweetId, xUserId, xUsername) {
  try {
    const username = String(xUsername || "").replace("@", "");

    if (!username) {
      return false;
    }

    const data = await xGet("/tweets/search/recent", {
      query: `conversation_id:${tweetId} from:${username}`,
      max_results: 10,
      "tweet.fields": "id,author_id,conversation_id"
    });

    return (data.data || []).some((tweet) => {
      return (
        String(tweet.author_id) === String(xUserId) &&
        String(tweet.conversation_id) === String(tweetId)
      );
    });
  } catch (error) {
    console.error("Comment check failed:", error.message);
    return false;
  }
}

async function checkTaskStatus({
  tweetId,
  officialId,
  xUserId,
  xUsername,
  accessToken
}) {
  const [followed, liked, reposted, commented] = await Promise.all([
    hasFollowed(xUserId, officialId, accessToken),
    hasLiked(tweetId, xUserId, accessToken),
    hasReposted(tweetId, xUserId),
    hasCommented(tweetId, xUserId, xUsername)
  ]);

  return {
    followed,
    liked,
    reposted,
    commented,
    completed: followed && liked && reposted && commented
  };
}

async function saveProgress(payload) {
  const { data: existing, error: findError } = await supabase
    .from("task_progress")
    .select("*")
    .eq("wallet_address", payload.wallet_address)
    .eq("task_id", payload.task_id)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("task_progress")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await supabase
    .from("task_progress")
    .insert(payload)
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const { wallet, taskId } = req.body || {};

    const walletAddress = String(wallet || "").toLowerCase();
    const currentTaskId = Number(taskId);

    if (!walletAddress || !walletAddress.startsWith("0x")) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet"
      });
    }

    if (!currentTaskId) {
      return res.status(400).json({
        success: false,
        error: "Missing taskId"
      });
    }

    const user = await getUserByWallet(walletAddress);

    if (!user?.x_user_id) {
      return res.status(400).json({
        success: false,
        error: "X authorization required",
        message: "Please connect X first."
      });
    }

    if (!user?.x_access_token) {
      return res.status(400).json({
        success: false,
        error: "X access token missing",
        message: "Please reconnect X."
      });
    }

    const task = await getTaskById(currentTaskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    const latestTask = await getLatestActiveTask();

    if (!latestTask) {
      return res.status(404).json({
        success: false,
        error: "No active task"
      });
    }

    if (Number(task.id) !== Number(latestTask.id)) {
      return res.status(400).json({
        success: false,
        error: "Only the latest official post can be claimed",
        message: "Old posts are not claimable.",
        taskId: task.id,
        latestTaskId: latestTask.id,
        tweetId: String(task.tweet_id),
        latestTweetId: String(latestTask.tweet_id)
      });
    }

    const tweetId = String(task.tweet_id);

    console.log("Verify request:", {
      wallet: walletAddress,
      taskId: task.id,
      tweetId,
      xUserId: user.x_user_id,
      xUsername: user.x_username
    });

    const official = await getOfficialUser();

    const result = await checkTaskStatus({
      tweetId,
      officialId: official.id,
      xUserId: user.x_user_id,
      xUsername: user.x_username,
      accessToken: user.x_access_token
    });

    console.log("Verify result:", {
      wallet: walletAddress,
      taskId: task.id,
      tweetId,
      followed: result.followed,
      liked: result.liked,
      reposted: result.reposted,
      commented: result.commented,
      completed: result.completed
    });

    const savedProgress = await saveProgress({
      task_id: task.id,
      tweet_id: tweetId,
      wallet_address: walletAddress,
      x_user_id: user.x_user_id,
      x_username: user.x_username,
      followed: result.followed,
      liked: result.liked,
      reposted: result.reposted,
      commented: result.commented,
      verified: result.completed,
      claimable: result.completed
    });

    if (!result.completed) {
      return res.status(200).json({
        success: false,
        message: "Mission is not completed yet.",
        taskId: task.id,
        tweetId,
        followed: result.followed,
        liked: result.liked,
        reposted: result.reposted,
        commented: result.commented,
        completed: result.completed,
        progress: savedProgress
      });
    }

    return res.status(200).json({
      success: true,
      message: "Mission verified.",
      taskId: task.id,
      tweetId,
      followed: result.followed,
      liked: result.liked,
      reposted: result.reposted,
      commented: result.commented,
      completed: result.completed,
      progress: savedProgress
    });
  } catch (error) {
    console.error("Verify error:", error);

    return res.status(500).json({
      success: false,
      error: "Verify failed",
      detail: error.message
    });
  }
}

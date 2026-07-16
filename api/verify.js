import { supabase } from "../lib/supabase.js";
import { getOAuthClient } from "../lib/x.js";

const X_API_BASE = "https://api.x.com/2";
const CONFIGURED_OFFICIAL_USERNAME = String(
  process.env.X_OFFICIAL_USERNAME || "GXFCLJ"
)
  .trim()
  .replace(/^@+/, "");
const OFFICIAL_USERNAME = /^[A-Za-z0-9_]{1,15}$/.test(
  CONFIGURED_OFFICIAL_USERNAME
)
  ? CONFIGURED_OFFICIAL_USERNAME
  : "Securityaler";
const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;

function createXAuthorizationError(message = "X authorization expired") {
  const error = new Error(message);
  error.code = "X_RECONNECT_REQUIRED";
  return error;
}

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

    const error = new Error(
      data?.detail ||
        data?.title ||
        data?.error ||
        data?.message ||
        "X API error"
    );

    error.name = "XApiError";
    error.status = res.status;
    error.rateLimitReset = res.headers.get("x-rate-limit-reset");
    throw error;
  }

  return data;
}

async function refreshUserAccessToken(user) {
  if (!user?.x_refresh_token) {
    throw createXAuthorizationError();
  }

  let refreshed;

  try {
    refreshed = await getOAuthClient().refreshOAuth2Token(user.x_refresh_token);
  } catch (error) {
    console.error("X token refresh failed:", {
      wallet: user.wallet_address,
      message: error.message
    });
    throw createXAuthorizationError();
  }

  const accessToken = refreshed?.accessToken;
  const refreshToken = refreshed?.refreshToken || user.x_refresh_token;
  const tokenExpiresAt = refreshed?.expiresIn
    ? new Date(Date.now() + Number(refreshed.expiresIn) * 1000).toISOString()
    : null;

  if (!accessToken) {
    throw createXAuthorizationError();
  }

  const { error } = await supabase
    .from("users")
    .update({
      x_access_token: accessToken,
      x_refresh_token: refreshToken,
      x_token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString()
    })
    .eq("wallet_address", String(user.wallet_address).toLowerCase());

  if (error) {
    throw error;
  }

  return accessToken;
}

async function getValidUserAccessToken(user) {
  if (!user?.x_access_token) {
    throw createXAuthorizationError("X access token missing");
  }

  const expiresAt = Date.parse(user.x_token_expires_at || "");
  const expiresSoon =
    Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60 * 1000;

  if (!expiresSoon) {
    return user.x_access_token;
  }

  return refreshUserAccessToken(user);
}

async function getOfficialUser(token) {
  const username = String(OFFICIAL_USERNAME).replace("@", "");

  const data = await xGet(
    `/users/by/username/${username}`,
    {
      "user.fields": "id,username,connection_status"
    },
    token
  );

  if (!data?.data?.id) {
    throw new Error("Official user not found");
  }

  return data.data;
}

async function getLatestOfficialTweet(officialId, token) {
  const data = await xGet(
    `/users/${officialId}/tweets`,
    {
      max_results: 5,
      exclude: "retweets,replies",
      "tweet.fields": "id,created_at"
    },
    token
  );

  const tweets = data.data || [];

  if (!tweets.length) {
    return null;
  }

  return tweets[0];
}

async function getTaskByTweetId(tweetId) {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("tweet_id", String(tweetId))
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function closeOtherTasks(activeTaskId) {
  let query = supabase
    .from("tasks")
    .update({
      active: false
    });

  if (activeTaskId) {
    query = query.neq("id", activeTaskId);
  } else {
    query = query.eq("active", true);
  }

  const { error } = await query;

  if (error) {
    throw error;
  }
}

async function activateTask(task) {
  await closeOtherTasks(task.id);

  if (task.active) {
    return task;
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      active: true
    })
    .eq("id", task.id)
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || task;
}

async function createTaskFromTweet(tweetId) {
  await closeOtherTasks(null);

  const title = `Official ${String(tweetId).slice(-6)}`;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      tweet_id: String(tweetId),
      reward_amount: "1",
      active: true,
      created_at: new Date().toISOString()
    })
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function ensureLatestTaskFromX(token) {
  const official = await getOfficialUser(token);
  const latestTweet = await getLatestOfficialTweet(official.id, token);

  if (!latestTweet?.id) {
    const { data: currentTask, error: currentTaskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("active", true)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentTaskError) {
      throw currentTaskError;
    }

    return {
      official,
      task: currentTask || null
    };
  }

  const tweetId = String(latestTweet.id);
  const existingTask = await getTaskByTweetId(tweetId);

  if (existingTask) {
    const activeTask = await activateTask(existingTask);

    return {
      official,
      task: activeTask
    };
  }

  const newTask = await createTaskFromTweet(tweetId);

  return {
    official,
    task: newTask
  };
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

async function hasFollowed(xUserId, official) {
  const connectionStatus = Array.isArray(official?.connection_status)
    ? official.connection_status
    : null;

  if (!connectionStatus) {
    const error = new Error("X connection status unavailable");
    error.code = "X_CONNECTION_STATUS_UNAVAILABLE";
    throw error;
  }

  const followed = connectionStatus.includes("following");

  return followed;
}

async function hasLiked(tweetId, xUserId, token) {
  const data = await xGet(
    `/users/${xUserId}/liked_tweets`,
    {
      max_results: 5,
      "tweet.fields": "id"
    },
    token
  );

  return (data.data || []).some((tweet) => {
    return String(tweet.id) === String(tweetId);
  });
}

async function hasReposted(tweetId, xUserId, token) {
  const data = await xGet(
    `/users/${xUserId}/tweets`,
    {
      max_results: 5,
      since_id: String(tweetId),
      exclude: "replies",
      "tweet.fields": "id,referenced_tweets"
    },
    token
  );

  return (data.data || []).some((tweet) => {
    const references = Array.isArray(tweet.referenced_tweets)
      ? tweet.referenced_tweets
      : [];

    return references.some(
      (reference) =>
        reference.type === "retweeted" &&
        String(reference.id) === String(tweetId)
    );
  });
}

async function hasCommented(tweetId, xUserId, token) {
  const data = await xGet(
    `/users/${xUserId}/tweets`,
    {
      max_results: 5,
      since_id: String(tweetId),
      exclude: "retweets",
      "tweet.fields":
        "id,author_id,conversation_id,referenced_tweets"
    },
    token
  );

  return (data.data || []).some((tweet) => {
    const references = Array.isArray(tweet.referenced_tweets)
      ? tweet.referenced_tweets
      : [];

    return (
      String(tweet.author_id) === String(xUserId) &&
      String(tweet.conversation_id) === String(tweetId) &&
      references.some((reference) => reference.type === "replied_to")
    );
  });
}

async function checkTaskStatus({
  tweetId,
  official,
  xUserId,
  accessToken
}) {
  const [followed, liked, reposted, commented] = await Promise.all([
    hasFollowed(xUserId, official),
    hasLiked(tweetId, xUserId, accessToken),
    hasReposted(tweetId, xUserId, accessToken),
    hasCommented(tweetId, xUserId, accessToken)
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

    const walletAddress = String(wallet || "").trim().toLowerCase();
    const requestedTaskId = taskId ? Number(taskId) : null;

    if (!WALLET_ADDRESS_PATTERN.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet"
      });
    }

    if (
      taskId !== undefined &&
      taskId !== null &&
      (!Number.isSafeInteger(requestedTaskId) || requestedTaskId <= 0)
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid taskId"
      });
    }

    const user = await getUserByWallet(walletAddress);

    if (!user?.x_user_id || !user?.x_username) {
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

    const accessToken = await getValidUserAccessToken(user);
    const latest = await ensureLatestTaskFromX(accessToken);

    if (!latest.task) {
      return res.status(404).json({
        success: false,
        error: "No active task"
      });
    }

    const task = latest.task;
    const tweetId = String(task.tweet_id);
    const xUserId = String(user.x_user_id);
    const xUsername = String(user.x_username);

    const result = await checkTaskStatus({
      tweetId,
      official: latest.official,
      xUserId,
      accessToken
    });

    const savedProgress = await saveProgress({
      task_id: task.id,
      tweet_id: tweetId,
      wallet_address: walletAddress,
      x_user_id: xUserId,
      x_username: xUsername,
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
        requestedTaskId,
        latestTaskId: task.id,
        tweetId,
        latestTweetId: tweetId,
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
      requestedTaskId,
      latestTaskId: task.id,
      tweetId,
      latestTweetId: tweetId,
      followed: result.followed,
      liked: result.liked,
      reposted: result.reposted,
      commented: result.commented,
      completed: result.completed,
      progress: savedProgress
    });
  } catch (error) {
    console.error("Verify error:", error);

    if (error.code === "X_RECONNECT_REQUIRED" || error.status === 401) {
      return res.status(401).json({
        success: false,
        error: "X authorization expired",
        message: "Please reconnect X.",
        reconnectX: true,
        verificationError: true
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        error: "Verification temporarily unavailable",
        retryable: true,
        verificationError: true
      });
    }

    if (error.name === "XApiError" || error.code === "X_PAGINATION_LIMIT") {
      return res.status(error.status === 403 ? 503 : 502).json({
        success: false,
        error: "Verification temporarily unavailable",
        retryable: error.status !== 403,
        verificationError: true
      });
    }

    return res.status(500).json({
      success: false,
      error: "Verification temporarily unavailable",
      verificationError: true
    });
  }
}

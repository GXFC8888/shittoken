import { supabase } from "../lib/supabase.js";

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

async function getProgress(walletAddress, taskId) {
  const { data, error } = await supabase
    .from("task_progress")
    .select("*")
    .eq("wallet_address", walletAddress)
    .eq("task_id", taskId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const { wallet, taskId, txHash } = req.body || {};

    const walletAddress = String(wallet || "").toLowerCase();
    const currentTaskId = Number(taskId);
    const txHashValue = txHash ? String(txHash) : null;

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

    const progress = await getProgress(walletAddress, task.id);

    if (!progress) {
      return res.status(400).json({
        success: false,
        error: "Task not verified",
        message: "Please verify the latest mission first.",
        taskId: task.id,
        tweetId: String(task.tweet_id)
      });
    }

    if (String(progress.tweet_id) !== String(task.tweet_id)) {
      return res.status(400).json({
        success: false,
        error: "Task progress mismatch",
        message: "Please verify the latest mission again.",
        taskId: task.id,
        taskTweetId: String(task.tweet_id),
        progressTweetId: String(progress.tweet_id)
      });
    }

    if (progress.claimed) {
      return res.status(400).json({
        success: false,
        error: "Already claimed",
        message: "Latest mission already claimed.",
        alreadyClaimed: true,
        lockClaim: true,
        taskId: task.id,
        tweetId: String(task.tweet_id)
      });
    }

    if (!progress.verified || !progress.claimable) {
      return res.status(400).json({
        success: false,
        error: "Not claimable yet",
        message: "Please complete and verify the latest mission first.",
        taskId: task.id,
        tweetId: String(task.tweet_id),
        followed: Boolean(progress.followed),
        liked: Boolean(progress.liked),
        reposted: Boolean(progress.reposted),
        commented: Boolean(progress.commented),
        verified: Boolean(progress.verified),
        claimable: Boolean(progress.claimable)
      });
    }

    const { data: updatedProgress, error: updateError } = await supabase
      .from("task_progress")
      .update({
        claimed: true,
        tx_hash: txHashValue,
        claimed_at: new Date().toISOString()
      })
      .eq("id", progress.id)
      .select()
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json({
      success: true,
      message: "Claim recorded",
      taskId: task.id,
      tweetId: String(task.tweet_id),
      txHash: txHashValue,
      progress: updatedProgress
    });
  } catch (err) {
    console.error("Claim error:", err);

    return res.status(500).json({
      success: false,
      error: "Claim failed",
      detail: err.message
    });
  }
}

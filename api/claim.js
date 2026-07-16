import { ethers } from "ethers";
import { supabase } from "../lib/supabase.js";
import { withEthereumQuorum } from "../lib/ethereum.js";

const CLAIM_CONTRACT = process.env.TWITTER_TASK_CLAIM_CONTRACT;
const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;
const CLAIM_CONTRACT_ABI = [
  "function claimedTweet(address user, bytes32 tweetHash) view returns (bool)",
  "function isClaimed(address user, bytes32 tweetHash) view returns (bool)"
];

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

function getTweetHash(tweetId) {
  return ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(String(tweetId))
  );
}

async function getAlreadyClaimedOnChain(claimContract, wallet, tweetHash) {
  try {
    return await claimContract.claimedTweet(wallet, tweetHash);
  } catch (error) {
    return claimContract.isClaimed(wallet, tweetHash);
  }
}

async function verifyClaimTransaction({ txHash, walletAddress, tweetId }) {
  if (!ethers.utils.isHexString(txHash, 32)) {
    return false;
  }

  if (!CLAIM_CONTRACT || !ethers.utils.isAddress(CLAIM_CONTRACT)) {
    throw new Error("Claim contract is not configured");
  }

  return withEthereumQuorum(
    async (provider) => {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (
        !receipt ||
        receipt.status !== 1 ||
        !receipt.from ||
        !receipt.to ||
        receipt.from.toLowerCase() !== walletAddress ||
        receipt.to.toLowerCase() !== CLAIM_CONTRACT.toLowerCase()
      ) {
        return false;
      }

      const claimContract = new ethers.Contract(
        CLAIM_CONTRACT,
        CLAIM_CONTRACT_ABI,
        provider
      );

      return Boolean(
        await getAlreadyClaimedOnChain(
          claimContract,
          walletAddress,
          getTweetHash(tweetId)
        )
      );
    },
    (result) => Boolean(result)
  );
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const { wallet, taskId, txHash } = req.body || {};

    const walletAddress = String(wallet || "").trim().toLowerCase();
    const currentTaskId = Number(taskId);
    const txHashValue = String(txHash || "").trim();

    if (!WALLET_ADDRESS_PATTERN.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet"
      });
    }

    if (!Number.isSafeInteger(currentTaskId) || currentTaskId <= 0) {
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

    const transactionVerified = await verifyClaimTransaction({
      txHash: txHashValue,
      walletAddress,
      tweetId: task.tweet_id
    });

    if (!transactionVerified) {
      return res.status(400).json({
        success: false,
        error: "Claim transaction not confirmed"
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
      .eq("claimed", false)
      .select()
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (!updatedProgress) {
      return res.status(409).json({
        success: false,
        error: "Already claimed",
        alreadyClaimed: true,
        lockClaim: true
      });
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

    if (err && err.code === "RPC_QUORUM_FAILED") {
      return res.status(503).json({
        success: false,
        error: "Ethereum RPC consensus unavailable",
        retryable: true
      });
    }

    return res.status(500).json({
      success: false,
      error: "Claim failed"
    });
  }
}

import { ethers } from "ethers";
import { supabase } from "../lib/supabase.js";
import {
  ETHEREUM_MAINNET_CHAIN_ID,
  withEthereumQuorum
} from "../lib/ethereum.js";

const CLAIM_CONTRACT = process.env.TWITTER_TASK_CLAIM_CONTRACT;

const CLAIM_SIGNER_PRIVATE_KEY =
  process.env.CLAIM_SIGNER_PRIVATE_KEY ||
  process.env.SIGNER_PRIVATE_KEY;

const CONFIGURED_CLAIM_SIGNATURE_TTL_SECONDS = Number(
  process.env.CLAIM_SIGNATURE_TTL_SECONDS || 600
);
const CLAIM_SIGNATURE_TTL_SECONDS =
  Number.isSafeInteger(CONFIGURED_CLAIM_SIGNATURE_TTL_SECONDS) &&
  CONFIGURED_CLAIM_SIGNATURE_TTL_SECONDS > 0 &&
  CONFIGURED_CLAIM_SIGNATURE_TTL_SECONDS <= 3600
    ? CONFIGURED_CLAIM_SIGNATURE_TTL_SECONDS
    : 600;

const CLAIM_TYPEHASH = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes(
    "TwitterTaskClaim(address contractAddress,uint256 chainId,address user,bytes32 tweetHash,uint256 amount,uint256 deadline)"
  )
);

const CLAIM_CONTRACT_ABI = [
  "function claimAmount() view returns (uint256)",
  "function signer() view returns (address)",
  "function claimedTweet(address user, bytes32 tweetHash) view returns (bool)",
  "function isClaimed(address user, bytes32 tweetHash) view returns (bool)"
];

function normalizeWallet(wallet) {
  return String(wallet || "").trim().toLowerCase();
}

function normalizePrivateKey(privateKey) {
  const key = String(privateKey || "").trim();

  if (!key) {
    return "";
  }

  return key.startsWith("0x") ? key : `0x${key}`;
}

function getTweetHash(tweetId) {
  return ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(String(tweetId))
  );
}

function getMessageHash({
  contractAddress,
  chainId,
  user,
  tweetHash,
  amount,
  deadline
}) {
  const encoded = ethers.utils.defaultAbiCoder.encode(
    [
      "bytes32",
      "address",
      "uint256",
      "address",
      "bytes32",
      "uint256",
      "uint256"
    ],
    [
      CLAIM_TYPEHASH,
      contractAddress,
      chainId,
      user,
      tweetHash,
      amount,
      deadline
    ]
  );

  return ethers.utils.keccak256(encoded);
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

async function getClaimableProgress(wallet, task) {
  const { data, error } = await supabase
    .from("task_progress")
    .select("*")
    .eq("wallet_address", wallet)
    .eq("task_id", task.id)
    .eq("tweet_id", String(task.tweet_id))
    .eq("verified", true)
    .eq("claimable", true)
    .eq("claimed", false)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function reconcileClaimedProgress(progress) {
  const { error } = await supabase
    .from("task_progress")
    .update({
      claimed: true,
      claimed_at: progress.claimed_at || new Date().toISOString()
    })
    .eq("id", progress.id)
    .eq("claimed", false);

  if (error) {
    throw error;
  }
}

async function getAlreadyClaimedOnChain(claimContract, wallet, tweetHash) {
  try {
    return await claimContract.claimedTweet(wallet, tweetHash);
  } catch (error) {
    try {
      return await claimContract.isClaimed(wallet, tweetHash);
    } catch (fallbackError) {
      throw error;
    }
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    if (!CLAIM_CONTRACT) {
      return res.status(500).json({
        success: false,
        error: "Missing TWITTER_TASK_CLAIM_CONTRACT"
      });
    }

    if (!CLAIM_SIGNER_PRIVATE_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing CLAIM_SIGNER_PRIVATE_KEY"
      });
    }

    const wallet = normalizeWallet(req.body.wallet);
    const requestedTweetId = req.body.tweetId ? String(req.body.tweetId) : "";

    if (!ethers.utils.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet address"
      });
    }

    if (!/^\d{1,30}$/.test(requestedTweetId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid tweetId"
      });
    }

    if (!ethers.utils.isAddress(CLAIM_CONTRACT)) {
      return res.status(500).json({
        success: false,
        error: "Invalid claim contract address"
      });
    }

    const latestTask = await getLatestActiveTask();

    if (!latestTask) {
      return res.status(404).json({
        success: false,
        error: "No active task"
      });
    }

    const latestTweetId = String(latestTask.tweet_id);

    if (String(requestedTweetId) !== latestTweetId) {
      return res.status(400).json({
        success: false,
        error: "Only the latest official post can be claimed",
        message: "Old posts are not claimable.",
        requestedTweetId: String(requestedTweetId),
        latestTweetId,
        latestTaskId: latestTask.id
      });
    }

    const progress = await getClaimableProgress(wallet, latestTask);

    if (!progress || !progress.tweet_id) {
      return res.status(400).json({
        success: false,
        error: "No claimable verified post found",
        message: "Please complete and verify the latest mission first.",
        taskId: latestTask.id,
        tweetId: latestTweetId
      });
    }

    if (String(progress.tweet_id) !== latestTweetId) {
      return res.status(400).json({
        success: false,
        error: "Task progress mismatch",
        message: "Please verify the latest mission again.",
        taskId: latestTask.id,
        latestTweetId,
        progressTweetId: String(progress.tweet_id)
      });
    }

    if (Number(progress.task_id) !== Number(latestTask.id)) {
      return res.status(400).json({
        success: false,
        error: "Task progress task mismatch",
        message: "Please verify the latest mission again.",
        taskId: latestTask.id,
        progressTaskId: progress.task_id
      });
    }

    const tweetId = latestTweetId;
    const tweetHash = getTweetHash(tweetId);

    const chainState = await withEthereumQuorum(
      async (provider) => {
        const claimContract = new ethers.Contract(
          CLAIM_CONTRACT,
          CLAIM_CONTRACT_ABI,
          provider
        );

        const alreadyClaimedOnChain = await getAlreadyClaimedOnChain(
          claimContract,
          wallet,
          tweetHash
        );

        if (alreadyClaimedOnChain) {
          return {
            alreadyClaimedOnChain: true,
            onChainClaimAmount: null,
            contractSigner: null
          };
        }

        const [claimAmountResult, contractSignerResult] = await Promise.all([
          claimContract.functions.claimAmount(),
          claimContract.functions.signer()
        ]);

        return {
          alreadyClaimedOnChain: false,
          onChainClaimAmount: claimAmountResult[0].toString(),
          contractSigner: String(contractSignerResult[0]).toLowerCase()
        };
      },
      (result) => ({
        alreadyClaimedOnChain: Boolean(result.alreadyClaimedOnChain),
        onChainClaimAmount: result.onChainClaimAmount,
        contractSigner: result.contractSigner
      })
    );

    if (chainState.alreadyClaimedOnChain) {
      // The on-chain transaction can succeed even if the browser closes or
      // loses its connection before /api/claim records the result. Treat the
      // contract as the source of truth and repair the database state here so
      // the page no longer keeps offering an impossible second claim.
      await reconcileClaimedProgress(progress);

      return res.status(400).json({
        success: false,
        error: "Already claimed on chain",
        message: "Latest mission already claimed.",
        alreadyClaimed: true,
        lockClaim: true,
        taskId: latestTask.id,
        tweetId
      });
    }

    const chainId = ETHEREUM_MAINNET_CHAIN_ID;
    const onChainClaimAmount = chainState.onChainClaimAmount;

    const backendSigner = new ethers.Wallet(
      normalizePrivateKey(CLAIM_SIGNER_PRIVATE_KEY)
    );

    const backendSignerAddress = await backendSigner.getAddress();

    const contractSigner = chainState.contractSigner;

    if (
      backendSignerAddress.toLowerCase() !==
      String(contractSigner).toLowerCase()
    ) {
      return res.status(500).json({
        success: false,
        error: "Claim service configuration error"
      });
    }

    const deadline =
      Math.floor(Date.now() / 1000) + CLAIM_SIGNATURE_TTL_SECONDS;

    const messageHash = getMessageHash({
      contractAddress: CLAIM_CONTRACT,
      chainId,
      user: wallet,
      tweetHash,
      amount: onChainClaimAmount.toString(),
      deadline
    });

    const signature = await backendSigner.signMessage(
      ethers.utils.arrayify(messageHash)
    );

    return res.status(200).json({
      success: true,
      contract: CLAIM_CONTRACT,
      chainId,
      user: wallet,
      tweetId,
      tweetHash,
      taskId: latestTask.id,
      amount: onChainClaimAmount.toString(),
      deadline,
      signature
    });
  } catch (error) {
    console.error("Claim signature error:", error);

    if (error && error.code === "RPC_QUORUM_FAILED") {
      return res.status(503).json({
        success: false,
        error: "Ethereum RPC consensus unavailable",
        retryable: true
      });
    }

    return res.status(500).json({
      success: false,
      error: "Claim signature failed"
    });
  }
}

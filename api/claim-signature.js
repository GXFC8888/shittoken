import { ethers } from "ethers";
import { supabase } from "../lib/supabase.js";

const BSC_RPC_URL =
  process.env.BSC_RPC_URL ||
  process.env.BSC_RPC ||
  "https://bsc-dataseed.binance.org";

const CLAIM_CONTRACT = process.env.TWITTER_TASK_CLAIM_CONTRACT;

const CLAIM_SIGNER_PRIVATE_KEY =
  process.env.CLAIM_SIGNER_PRIVATE_KEY ||
  process.env.SIGNER_PRIVATE_KEY;

const CLAIM_SIGNATURE_TTL_SECONDS = Number(
  process.env.CLAIM_SIGNATURE_TTL_SECONDS || 600
);

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

async function getClaimableProgress(wallet, tweetId) {
  let query = supabase
    .from("task_progress")
    .select("*")
    .eq("wallet_address", wallet)
    .eq("verified", true)
    .eq("claimable", true)
    .eq("claimed", false)
    .not("tweet_id", "is", null)
    .order("id", { ascending: false })
    .limit(1);

  if (tweetId) {
    query = query.eq("tweet_id", String(tweetId));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data;
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

    if (!ethers.utils.isAddress(CLAIM_CONTRACT)) {
      return res.status(500).json({
        success: false,
        error: "Invalid claim contract address"
      });
    }

    const progress = await getClaimableProgress(wallet, requestedTweetId);

    if (!progress || !progress.tweet_id) {
      return res.status(400).json({
        success: false,
        error: "No claimable verified post found"
      });
    }

    const tweetId = String(progress.tweet_id);
    const tweetHash = getTweetHash(tweetId);

    const provider = new ethers.providers.JsonRpcProvider(BSC_RPC_URL);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

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
      return res.status(400).json({
        success: false,
        error: "Already claimed on chain"
      });
    }

    const claimAmountResult = await claimContract.functions.claimAmount();
    const onChainClaimAmount = claimAmountResult[0];

    const backendSigner = new ethers.Wallet(
      normalizePrivateKey(CLAIM_SIGNER_PRIVATE_KEY)
    );

    const backendSignerAddress = await backendSigner.getAddress();

    const contractSignerResult = await claimContract.functions.signer();
    const contractSigner = contractSignerResult[0];

    if (
      backendSignerAddress.toLowerCase() !==
      String(contractSigner).toLowerCase()
    ) {
      return res.status(500).json({
        success: false,
        error: "Backend signer does not match contract signer",
        backendSigner: backendSignerAddress,
        contractSigner
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
      taskId: progress.task_id,
      amount: onChainClaimAmount.toString(),
      deadline,
      signature
    });
  } catch (error) {
    console.error("Claim signature error:", error);

    return res.status(500).json({
      success: false,
      error: "Claim signature failed",
      detail: error.message || String(error)
    });
  }
}

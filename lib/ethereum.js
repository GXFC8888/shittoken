import { ethers } from "ethers";

export const ETHEREUM_MAINNET_CHAIN_ID = 1;

const DEFAULT_FREE_ETH_RPC_URLS = [
  "https://ethereum-rpc.publicnode.com",
  "https://ethereum.public.blockpi.network/v1/rpc/public",
  "https://rpc.mevblocker.io",
  "https://eth-mainnet.g.alchemy.com/public",
  "https://ethereum-rpc.blockreq.com/v1/rpc/public",
  "https://eth-mainnet.public.blastapi.io",
  "https://eth-pokt.nodies.app",
  "https://public-eth.nownodes.io"
];

const CONFIGURED_RPC_TIMEOUT_MS = Number(
  process.env.ETH_RPC_TIMEOUT_MS || 5000
);
const RPC_TIMEOUT_MS =
  Number.isSafeInteger(CONFIGURED_RPC_TIMEOUT_MS) &&
  CONFIGURED_RPC_TIMEOUT_MS >= 1000 &&
  CONFIGURED_RPC_TIMEOUT_MS <= 15000
    ? CONFIGURED_RPC_TIMEOUT_MS
    : 5000;

function parseRpcUrls(value) {
  return String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function isSupportedRpcUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (error) {
    return false;
  }
}

function getEthereumRpcUrls() {
  const primaryRpcUrl = String(process.env.ETH_RPC_URL || "").trim();
  const customFallbackRpcUrls = parseRpcUrls(
    process.env.ETH_FALLBACK_RPC_URLS
  );

  return [
    primaryRpcUrl,
    ...customFallbackRpcUrls,
    ...DEFAULT_FREE_ETH_RPC_URLS
  ].filter(isSupportedRpcUrl).filter((url, index, urls) => {
    return urls.indexOf(url) === index;
  });
}

function getRpcLabel(rpcUrl, role) {
  let hostname = "configured endpoint";

  try {
    hostname = new URL(rpcUrl).hostname;
  } catch (error) {
    // Invalid URLs are removed before this function is called.
  }

  return `${role} ${hostname}`;
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;

  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error("Ethereum RPC request timed out");
      error.code = "RPC_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function runEthereumRpcOperation(rpcUrl, operation) {
  const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
    name: "homestead",
    chainId: ETHEREUM_MAINNET_CHAIN_ID
  });

  return withTimeout(
    (async () => {
      const [chainId, result] = await Promise.all([
        provider.send("eth_chainId", []),
        operation(provider)
      ]);

      if (Number(chainId) !== ETHEREUM_MAINNET_CHAIN_ID) {
        const error = new Error("RPC endpoint is not Ethereum Mainnet");
        error.code = "WRONG_NETWORK";
        throw error;
      }

      return result;
    })(),
    RPC_TIMEOUT_MS
  );
}

function logRpcFailure(rpcUrl, role, error) {
  const errorCode = String(
    (error && (error.code || error.name)) || "RPC_ERROR"
  );
  const rpcLabel = getRpcLabel(rpcUrl, role);

  console.warn(`[Ethereum RPC] ${rpcLabel} failed (${errorCode}).`);
}

function getConsensusKey(result, createConsensusKey) {
  const rawKey = createConsensusKey(result);

  if (rawKey === undefined) {
    throw new TypeError("Ethereum RPC consensus key cannot be undefined");
  }

  if (typeof rawKey === "string") {
    return rawKey;
  }

  const serializedKey = JSON.stringify(rawKey);

  if (serializedKey === undefined) {
    throw new TypeError("Ethereum RPC consensus key is not serializable");
  }

  return serializedKey;
}

async function tryRpcQuorumBatch({
  rpcUrls,
  operation,
  createConsensusKey,
  quorum,
  resultGroups
}) {
  if (!rpcUrls.length) {
    return null;
  }

  const attempts = rpcUrls.map(async (rpcUrl) => {
    try {
      const result = await runEthereumRpcOperation(rpcUrl, operation);
      const key = getConsensusKey(result, createConsensusKey);
      const group = resultGroups.get(key) || {
        count: 0,
        result
      };

      group.count += 1;
      resultGroups.set(key, group);

      if (group.count >= quorum) {
        return {
          matched: true,
          result: group.result
        };
      }

      const error = new Error("Waiting for Ethereum RPC quorum");
      error.code = "RPC_QUORUM_PENDING";
      throw error;
    } catch (error) {
      if (error && error.code !== "RPC_QUORUM_PENDING") {
        logRpcFailure(rpcUrl, "fallback", error);
      }

      throw error;
    }
  });

  try {
    return await Promise.any(attempts);
  } catch (error) {
    return null;
  }
}

export async function withEthereumProvider(operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Ethereum RPC operation must be a function");
  }

  const rpcUrls = getEthereumRpcUrls();
  const primaryRpcUrl = String(process.env.ETH_RPC_URL || "").trim();
  let fallbackRpcUrls = rpcUrls;

  if (primaryRpcUrl && rpcUrls[0] === primaryRpcUrl) {
    try {
      return await runEthereumRpcOperation(primaryRpcUrl, operation);
    } catch (error) {
      logRpcFailure(primaryRpcUrl, "primary", error);
      fallbackRpcUrls = rpcUrls.slice(1);
    }
  }

  const fallbackAttempts = fallbackRpcUrls.map((rpcUrl) => {
    return runEthereumRpcOperation(rpcUrl, operation).catch((error) => {
      logRpcFailure(rpcUrl, "fallback", error);
      throw error;
    });
  });

  try {
    return await Promise.any(fallbackAttempts);
  } catch (error) {
    throw new Error("All Ethereum RPC endpoints are unavailable");
  }
}

export async function withEthereumQuorum(
  operation,
  createConsensusKey,
  quorum = 2
) {
  if (typeof operation !== "function") {
    throw new TypeError("Ethereum RPC operation must be a function");
  }

  if (typeof createConsensusKey !== "function") {
    throw new TypeError("Ethereum RPC consensus key function is required");
  }

  if (!Number.isSafeInteger(quorum) || quorum < 2) {
    throw new TypeError("Ethereum RPC quorum must be at least 2");
  }

  const rpcUrls = getEthereumRpcUrls();
  const primaryRpcUrl = String(process.env.ETH_RPC_URL || "").trim();
  let fallbackRpcUrls = rpcUrls;

  if (primaryRpcUrl && rpcUrls[0] === primaryRpcUrl) {
    try {
      return await runEthereumRpcOperation(primaryRpcUrl, operation);
    } catch (error) {
      logRpcFailure(primaryRpcUrl, "primary", error);
      fallbackRpcUrls = rpcUrls.slice(1);
    }
  }

  if (fallbackRpcUrls.length < quorum) {
    const error = new Error("Not enough Ethereum RPC endpoints for quorum");
    error.code = "RPC_QUORUM_FAILED";
    throw error;
  }

  const resultGroups = new Map();
  const batchSize = Math.max(3, quorum);

  for (let index = 0; index < fallbackRpcUrls.length; index += batchSize) {
    const batchResult = await tryRpcQuorumBatch({
      rpcUrls: fallbackRpcUrls.slice(index, index + batchSize),
      operation,
      createConsensusKey,
      quorum,
      resultGroups
    });

    if (batchResult && batchResult.matched) {
      return batchResult.result;
    }
  }

  const error = new Error("Ethereum RPC quorum not reached");
  error.code = "RPC_QUORUM_FAILED";
  throw error;
}

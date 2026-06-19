const BSC_CHAIN_ID_HEX = "0x38";
const BSC_CHAIN_ID_DEC = 56;

const BSC_RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc.publicnode.com",
  "https://rpc.ankr.com/bsc"
];

const OFFICIAL_X_USERNAME = "GXFCLJ";
const OFFICIAL_X_WEB_URL = `https://x.com/${OFFICIAL_X_USERNAME}`;
const OFFICIAL_X_APP_URL = `twitter://user?screen_name=${OFFICIAL_X_USERNAME}`;

const TWITTER_TASK_CLAIM_ABI = [
  "function claim(bytes32 tweetHash, uint256 deadline, bytes signature) payable",
  "function claimFee() view returns (uint256)",
  "function claimAmount() view returns (uint256)",
  "function signer() view returns (address)",
  "function isClaimed(address user, bytes32 tweetHash) view returns (bool)"
];

let provider = null;
let signer = null;
let userAddress = null;

let currentTasks = [];
let currentProgress = [];
let currentXConnected = false;
let currentXUsername = null;

let isConnectingWallet = false;
let isLoadingTasks = false;
let isVerifying = false;

let currentOfficialTweetId =
  localStorage.getItem("current_official_tweet_id") || null;

const connectBtn = document.getElementById("connectBtn");

const connectXBtn =
  document.getElementById("connectXBtn") ||
  document.getElementById("xConnectBtn");

const refreshMissionsBtn =
  document.getElementById("refreshMissionsBtn") ||
  document.getElementById("refreshTasksBtn");

const missionList =
  document.getElementById("missionList") ||
  document.getElementById("tasksList");

const message = document.getElementById("message");
const walletText = document.getElementById("walletText");

const xStatusText =
  document.getElementById("xStatusText") ||
  document.getElementById("xAccountText");

const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");

function showMessage(text, type) {
  if (!message) return;

  message.innerText = text || "";
  message.classList.remove("ok", "err");

  if (type === "ok") {
    message.classList.add("ok");
  }

  if (type === "err") {
    message.classList.add("err");
  }
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeWallet(address) {
  return String(address || "").toLowerCase();
}

function setCurrentOfficialTweetId(tweetId) {
  if (!tweetId) return;

  currentOfficialTweetId = String(tweetId);
  localStorage.setItem("current_official_tweet_id", currentOfficialTweetId);
}

function getLatestTask() {
  if (!currentTasks.length) return null;

  return [...currentTasks]
    .filter((task) => task && task.active !== false)
    .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
    .at(-1) || null;
}

function getOfficialXTargetUrl(tweetId = null) {
  const id =
    tweetId ||
    currentOfficialTweetId ||
    (getLatestTask() ? String(getLatestTask().tweet_id) : null);

  if (id) {
    return `https://x.com/${OFFICIAL_X_USERNAME}/status/${id}`;
  }

  return OFFICIAL_X_WEB_URL;
}

function getOfficialXTargetAppUrl(tweetId = null) {
  const id =
    tweetId ||
    currentOfficialTweetId ||
    (getLatestTask() ? String(getLatestTask().tweet_id) : null);

  if (id) {
    return `twitter://status?id=${id}`;
  }

  return OFFICIAL_X_APP_URL;
}

function getReadableError(error) {
  if (!error) return "Unknown error";

  const rawMessage = [
    error.data && error.data.message,
    error.error && error.error.message,
    error.responseData && error.responseData.message,
    error.responseData && error.responseData.error,
    error.responseData && error.responseData.detail,
    error.reason,
    error.message,
    String(error)
  ]
    .filter(Boolean)
    .join(" ");

  const lowerMessage = rawMessage.toLowerCase();

  if (error.code === 4001 || lowerMessage.includes("user rejected")) {
    return "User rejected the request.";
  }

  if (error.code === -32002 || lowerMessage.includes("already pending")) {
    return "Wallet request already pending. Please open your wallet.";
  }

  if (lowerMessage.includes("insufficient funds")) {
    return "Insufficient BNB for gas.";
  }

  if (lowerMessage.includes("already claimed")) {
    return "Already claimed.";
  }

  if (lowerMessage.includes("insufficient fee")) {
    return "Insufficient BNB fee.";
  }

  if (lowerMessage.includes("invalid signer")) {
    return "Invalid claim signature.";
  }

  if (lowerMessage.includes("signature expired")) {
    return "Claim signature expired. Please verify again.";
  }

  if (error.data && error.data.message) return error.data.message;
  if (error.error && error.error.message) return error.error.message;
  if (error.responseData && error.responseData.detail) return error.responseData.detail;
  if (error.responseData && error.responseData.error) return error.responseData.error;
  if (error.responseData && error.responseData.message) return error.responseData.message;
  if (error.reason) return error.reason;
  if (error.message) return error.message;

  return String(error);
}

function getWalletProvider() {
  if (window.okxwallet && window.okxwallet.ethereum) {
    return window.okxwallet.ethereum;
  }

  if (window.ethereum) {
    return window.ethereum;
  }

  return null;
}

async function switchToBSC() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    throw new Error("No wallet provider found");
  }

  try {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }]
    });
  } catch (error) {
    if (error && error.code === 4902) {
      await walletProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BSC_CHAIN_ID_HEX,
            chainName: "BNB Smart Chain",
            nativeCurrency: {
              name: "BNB",
              symbol: "BNB",
              decimals: 18
            },
            rpcUrls: BSC_RPC_URLS,
            blockExplorerUrls: ["https://bscscan.com"]
          }
        ]
      });
    } else {
      throw error;
    }
  }
}

function getXStorageKey(address) {
  return `x_connected_${normalizeWallet(address)}`;
}

function setXConnected(address) {
  if (!address) return;
  localStorage.setItem(getXStorageKey(address), "true");
}

function clearXConnected(address) {
  if (!address) return;
  localStorage.removeItem(getXStorageKey(address));
}

function isXConnected() {
  return Boolean(currentXConnected);
}

function updateWalletUI() {
  const activeWallet = userAddress || localStorage.getItem("wallet_address");
  const connectedX = isXConnected();

  if (connectBtn) {
    connectBtn.innerText = activeWallet ? shortAddress(activeWallet) : "connect wallet";
    connectBtn.disabled = false;
  }

  if (walletText) {
    walletText.innerText = activeWallet ? shortAddress(activeWallet) : "Not connected";
  }

  if (xStatusText) {
    xStatusText.innerText = connectedX
      ? currentXUsername
        ? `Connected @${currentXUsername}`
        : "Connected"
      : "Not connected";
  }

  if (connectXBtn) {
    connectXBtn.innerText = connectedX ? "reconnect X" : "connect X";
    connectXBtn.disabled = !activeWallet;
  }

  if (refreshMissionsBtn) {
    refreshMissionsBtn.innerText = activeWallet ? "Wallet Connected" : "Connect Wallet";
    refreshMissionsBtn.disabled = Boolean(activeWallet);
  }
}

function resetWalletUI() {
  const oldWallet = userAddress || localStorage.getItem("wallet_address");

  provider = null;
  signer = null;
  userAddress = null;

  currentTasks = [];
  currentProgress = [];
  currentXConnected = false;
  currentXUsername = null;
  currentOfficialTweetId = null;

  localStorage.removeItem("wallet_connected");
  localStorage.removeItem("wallet_address");
  localStorage.removeItem("pending_official_verify");
  localStorage.removeItem("pending_verify_task_id");
  localStorage.removeItem("pending_official_x");
  localStorage.removeItem("pending_open_tweet_id");
  localStorage.removeItem("pending_x_wallet");
  localStorage.removeItem("x_username");
  localStorage.removeItem("current_official_tweet_id");

  if (oldWallet) {
    clearXConnected(oldWallet);
  }

  updateWalletUI();
  renderMissions();

  showMessage("");
}

async function setupWalletAfterConnected() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    throw new Error("No wallet provider found");
  }

  provider = new ethers.providers.Web3Provider(walletProvider, "any");
  signer = provider.getSigner();
  userAddress = await signer.getAddress();

  localStorage.setItem("wallet_connected", "true");
  localStorage.setItem("wallet_address", userAddress);

  updateWalletUI();

  await loadTasks(false);
}

async function connectWallet() {
  if (isConnectingWallet) return;

  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    showMessage(
      "Please open this page in TokenPocket, MetaMask, OKX Wallet, Trust Wallet or another Web3 wallet browser.",
      "err"
    );
    return;
  }

  try {
    isConnectingWallet = true;

    if (connectBtn) {
      connectBtn.disabled = true;
      connectBtn.innerText = "connecting...";
    }

    if (refreshMissionsBtn) {
      refreshMissionsBtn.disabled = true;
      refreshMissionsBtn.innerText = "connecting...";
    }

    showMessage("Connecting wallet...");

    await switchToBSC();

    provider = new ethers.providers.Web3Provider(walletProvider, "any");

    await provider.send("eth_requestAccounts", []);

    await setupWalletAfterConnected();

    showMessage("Wallet connected.", "ok");
  } catch (error) {
    console.error(error);
    showMessage("Wallet connection failed: " + getReadableError(error), "err");

    if (connectBtn) {
      connectBtn.innerText = "connect wallet";
    }

    if (refreshMissionsBtn) {
      refreshMissionsBtn.innerText = "Connect Wallet";
    }
  } finally {
    isConnectingWallet = false;

    if (connectBtn) {
      connectBtn.disabled = false;
    }

    updateWalletUI();
  }
}

async function autoConnectWallet() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) return;
  if (localStorage.getItem("wallet_connected") !== "true") return;

  try {
    const accounts = await walletProvider.request({
      method: "eth_accounts"
    });

    if (!accounts || accounts.length === 0) {
      resetWalletUI();
      return;
    }

    await switchToBSC();
    await setupWalletAfterConnected();
  } catch (error) {
    console.error(error);
  }
}

function listenWalletChange() {
  const walletProvider = getWalletProvider();

  if (!walletProvider || !walletProvider.on) return;

  walletProvider.on("accountsChanged", async (accounts) => {
    if (accounts && accounts.length > 0) {
      try {
        currentOfficialTweetId = null;
        localStorage.removeItem("current_official_tweet_id");
        localStorage.removeItem("pending_verify_task_id");
        localStorage.removeItem("pending_open_tweet_id");

        await setupWalletAfterConnected();

        showMessage("Wallet account changed.", "ok");
      } catch (error) {
        console.error(error);
        showMessage("Wallet account changed, please reconnect.", "err");
      }
    } else {
      resetWalletUI();
      showMessage("Wallet disconnected.", "err");
    }
  });

  walletProvider.on("chainChanged", async () => {
    try {
      await setupWalletAfterConnected();
    } catch (error) {
      console.error(error);
      window.location.reload();
    }
  });
}

function connectX() {
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  localStorage.setItem("pending_x_wallet", activeWallet);

  window.location.href = `/api/auth/x/login?wallet=${encodeURIComponent(activeWallet)}`;
}

async function loadTasks(runPendingActions = true) {
  if (isLoadingTasks) return;

  try {
    isLoadingTasks = true;

    if (refreshMissionsBtn) {
      refreshMissionsBtn.disabled = true;
      refreshMissionsBtn.innerText = "loading...";
    }

    const activeWallet = userAddress || localStorage.getItem("wallet_address") || "";
    const params = new URLSearchParams();

    if (activeWallet) {
      params.set("wallet", activeWallet);
    }

    params.set("_t", String(Date.now()));

    const response = await fetch(`/api/tasks?${params.toString()}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({}));

    if (!data.success) {
      throw new Error(data.detail || data.error || "Failed to load missions");
    }

    currentTasks = Array.isArray(data.tasks) ? data.tasks : [];
    currentProgress = Array.isArray(data.progress) ? data.progress : [];
    currentXConnected = Boolean(data.xConnected);
    currentXUsername = data.xUsername || null;

    const latestTask = getLatestTask();

    if (latestTask && latestTask.tweet_id) {
      setCurrentOfficialTweetId(latestTask.tweet_id);
    }

    if (activeWallet) {
      if (currentXConnected) {
        setXConnected(activeWallet);

        if (currentXUsername) {
          localStorage.setItem("x_username", currentXUsername);
        }
      } else {
        clearXConnected(activeWallet);
        localStorage.removeItem("x_username");
        localStorage.removeItem("pending_official_verify");
        localStorage.removeItem("pending_verify_task_id");
      }
    }

    updateWalletUI();
    renderMissions();

    if (activeWallet && currentXConnected) {
      showMessage("X account connected. Complete the latest mission, then claim.", "ok");

      if (runPendingActions) {
        const pendingVerifyTaskId = localStorage.getItem("pending_verify_task_id");

        if (pendingVerifyTaskId) {
          const pendingTask = getTaskById(pendingVerifyTaskId);
          localStorage.removeItem("pending_verify_task_id");
          localStorage.removeItem("pending_official_verify");

          if (pendingTask && isLatestTask(pendingTask)) {
            setTimeout(() => {
              verifyAndClaim(pendingTask);
            }, 600);
            return;
          }
        }
      }
    } else if (activeWallet && !currentXConnected) {
      showMessage("Wallet connected. Connect X first, then complete the latest mission.", "ok");
    } else {
      showMessage("Connect your wallet to load missions.", "err");
    }
  } catch (error) {
    console.error(error);
    showMessage("Load missions failed: " + getReadableError(error), "err");
  } finally {
    isLoadingTasks = false;

    const activeWallet = userAddress || localStorage.getItem("wallet_address");

    if (refreshMissionsBtn) {
      refreshMissionsBtn.innerText = activeWallet ? "Wallet Connected" : "Connect Wallet";
      refreshMissionsBtn.disabled = Boolean(activeWallet);
    }
  }
}

function getTaskById(taskId) {
  return currentTasks.find((item) => Number(item.id) === Number(taskId)) || null;
}

function isLatestTask(task) {
  const latestTask = getLatestTask();

  if (!task || !latestTask) return false;

  return Number(task.id) === Number(latestTask.id);
}

function getProgressByTaskId(taskId) {
  return (
    currentProgress.find((item) => Number(item.task_id) === Number(taskId)) ||
    null
  );
}

function getProgressByTweetId(tweetId) {
  return (
    currentProgress.find((item) => String(item.tweet_id) === String(tweetId)) ||
    null
  );
}

function getProgressForTask(task) {
  if (!task) return null;

  return (
    getProgressByTaskId(task.id) ||
    getProgressByTweetId(task.tweet_id)
  );
}

function getLatestTaskProgress() {
  const latestTask = getLatestTask();
  return latestTask ? getProgressForTask(latestTask) : null;
}

function getTaskStatus(progress) {
  if (!progress) return "Not completed";
  if (progress.claimed) return "Claimed";
  if (progress.claimable || progress.verified) return "Ready";
  if (
    progress.followed ||
    progress.liked ||
    progress.reposted ||
    progress.commented
  ) {
    return "Checking";
  }

  return "Not completed";
}

function renderMissions() {
  if (!missionList) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    missionList.innerHTML = `
      <div class="mission-card empty">
        <h3>Connect your wallet to load the latest official X mission.</h3>
        <p>Use TokenPocket, MetaMask, OKX Wallet, Trust Wallet or another Web3 wallet browser.</p>
      </div>
    `;
    return;
  }

  const latestTask = getLatestTask();

  if (!latestTask) {
    missionList.innerHTML = `
      <div class="mission-card empty">
        <h3>No active mission yet.</h3>
        <p>Please refresh later.</p>
      </div>
    `;
    return;
  }

  const progress = getProgressForTask(latestTask);
  const tweetId = String(latestTask.tweet_id);
  const tweetUrl = `https://x.com/${OFFICIAL_X_USERNAME}/status/${tweetId}`;
  const claimed = Boolean(progress && progress.claimed);
  const claimable = Boolean(progress && progress.claimable);
  const verified = Boolean(progress && progress.verified);
  const statusText = getTaskStatus(progress);
  const verifyDisabled = isVerifying || claimed;
  const openDisabled = claimed || currentXConnected;

  const openButtonText = claimed
    ? "Completed"
    : currentXConnected
      ? "X Authorized"
      : "Open X";

  const verifyButtonText = claimed
    ? "Claimed"
    : isVerifying
      ? "checking..."
      : claimable || verified
        ? "Claim Reward"
        : "Verify & Claim";

  missionList.innerHTML = `
    <div class="mission-summary">
      <span>Latest mission only</span>
      <span>${currentXConnected ? `@${escapeHtml(currentXUsername || "connected")}` : "X not connected"}</span>
    </div>

    <div class="mission-card" data-task-id="${latestTask.id}" data-tweet-id="${tweetId}">
      <div class="mission-head">
        <div>
          <h3>${escapeHtml(latestTask.title || "Official X Mission")}</h3>
          <p class="reward">Reward: ${escapeHtml(latestTask.reward_amount || "1")} drop</p>
        </div>
        <span class="mission-status ${claimed ? "done" : "ready"}">${statusText}</span>
      </div>

      <p>
        Follow @${OFFICIAL_X_USERNAME}, like, repost, and comment on the latest official post.
        Come back here and tap Verify & Claim.
        Old posts are not claimable.
      </p>

      <a class="mission-link" href="${tweetUrl}" target="_blank" rel="noopener noreferrer">
        ${tweetUrl}
      </a>

      <div class="mission-actions">
        <button class="btn full light open-task-btn" type="button" data-tweet-id="${tweetId}" ${openDisabled ? "disabled" : ""}>
          ${openButtonText}
        </button>

        <button class="btn full gold verify-task-btn" type="button" data-task-id="${latestTask.id}" ${verifyDisabled ? "disabled" : ""}>
          ${verifyButtonText}
        </button>
      </div>
    </div>
  `;

  const openButton = missionList.querySelector(".open-task-btn");
  const verifyButton = missionList.querySelector(".verify-task-btn");

  if (openButton) {
    openButton.addEventListener("click", () => {
      if (claimed) {
        showMessage("Latest mission already claimed.", "ok");
        return;
      }

      if (currentXConnected) {
        showMessage("X already authorized. Complete the mission on X, then tap Verify & Claim.", "ok");
        return;
      }

      openTaskX(tweetId);
    });
  }

  if (verifyButton) {
    verifyButton.addEventListener("click", () => {
      if (claimed) {
        showMessage("Latest mission already claimed.", "ok");
        return;
      }

      verifyAndClaim(latestTask);
    });
  }
}

function openTaskX(tweetId) {
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  const latestTask = getLatestTask();

  if (latestTask && tweetId && String(tweetId) !== String(latestTask.tweet_id)) {
    showMessage("Only the latest official post can be claimed.", "err");
    return;
  }

  const latestProgress = getLatestTaskProgress();

  if (latestProgress && latestProgress.claimed) {
    showMessage("Latest mission already claimed.", "ok");
    return;
  }

  localStorage.setItem("pending_official_x", "true");

  if (tweetId) {
    setCurrentOfficialTweetId(tweetId);
  }

  if (!isXConnected()) {
    localStorage.setItem("pending_x_wallet", activeWallet);

    showMessage("X authorization is required first. Redirecting to X...", "ok");

    setTimeout(() => {
      window.location.href = `/api/auth/x/login?wallet=${encodeURIComponent(activeWallet)}`;
    }, 300);

    return;
  }

  openTaskXDirect(tweetId);
}

function openTaskXDirect(tweetId) {
  const latestTask = getLatestTask();

  if (latestTask && tweetId && String(tweetId) !== String(latestTask.tweet_id)) {
    setCurrentOfficialTweetId(tweetId);
  }

  showMessage(
    `Opening @${OFFICIAL_X_USERNAME}. Follow, like, repost, and comment on the latest post, then manually return here to claim.`,
    "ok"
  );

  const targetWebUrl = getOfficialXTargetUrl(tweetId);
  const targetAppUrl = getOfficialXTargetAppUrl(tweetId);

  try {
    navigator.clipboard.writeText(targetWebUrl).catch(() => {});
  } catch (error) {}

  const userAgent = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);

  let appOpened = false;

  const onVisibilityChange = () => {
    if (document.hidden) {
      appOpened = true;
    }
  };

  const onPageHide = () => {
    appOpened = true;
  };

  document.addEventListener("visibilitychange", onVisibilityChange, { once: true });
  window.addEventListener("pagehide", onPageHide, { once: true });

  if (isIOS) {
    window.location.href = targetAppUrl;

    setTimeout(() => {
      if (!appOpened) {
        window.location.href = targetWebUrl;
      }
    }, 3200);

    return;
  }

  window.location.href = targetAppUrl;

  setTimeout(() => {
    if (!appOpened) {
      window.location.href = targetWebUrl;
    }
  }, 1800);
}

function shouldLockClaimButton(data) {
  if (data && (data.lockClaim || data.alreadyClaimed)) {
    return true;
  }

  const text = String(
    data && (data.message || data.error || data.detail || "")
  ).toLowerCase();

  return (
    text.includes("already claimed") ||
    text.includes("latest official post already claimed") ||
    text.includes("no unclaimed official posts found") ||
    text.includes("already claimed on chain")
  );
}

function needsXAuthorization(data) {
  const text = String(
    data && (data.message || data.error || data.detail || "")
  ).toLowerCase();

  return (
    text.includes("connect x") ||
    text.includes("please connect x") ||
    text.includes("x authorization required") ||
    text.includes("x authorization is required") ||
    text.includes("authorization is required") ||
    text.includes("x first") ||
    text.includes("x account not connected") ||
    text.includes("no x account")
  );
}

function redirectToXAuthorization(activeWallet, taskId = null) {
  localStorage.setItem("pending_official_verify", "true");
  localStorage.setItem("pending_x_wallet", activeWallet);

  if (taskId) {
    localStorage.setItem("pending_verify_task_id", String(taskId));
  }

  showMessage("X authorization is required once. Redirecting to X...", "ok");

  setTimeout(() => {
    window.location.href = `/api/auth/x/login?wallet=${encodeURIComponent(activeWallet)}`;
  }, 300);
}

async function getClaimSignature(activeWallet, tweetId) {
  const response = await fetch("/api/claim-signature", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "include",
    body: JSON.stringify({
      wallet: activeWallet,
      tweetId: String(tweetId)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!data.success) {
    const error = new Error(data.error || data.detail || "Failed to get claim signature");
    error.responseData = data;
    throw error;
  }

  return data;
}

async function claimOnChain(signatureData, activeWallet) {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    throw new Error("No wallet provider found");
  }

  await switchToBSC();

  const web3Provider = new ethers.providers.Web3Provider(walletProvider, "any");
  const web3Signer = web3Provider.getSigner();
  const connectedAddress = await web3Signer.getAddress();

  if (connectedAddress.toLowerCase() !== activeWallet.toLowerCase()) {
    throw new Error("Connected wallet does not match verified wallet");
  }

  const contract = new ethers.Contract(
    signatureData.contract,
    TWITTER_TASK_CLAIM_ABI,
    web3Signer
  );

  const alreadyClaimed = await contract.isClaimed(
    activeWallet,
    signatureData.tweetHash
  );

  if (alreadyClaimed) {
    throw new Error("Already claimed on chain");
  }

  const claimFee = await contract.claimFee();

  showMessage("Please confirm the on-chain claim transaction in your wallet.", "ok");

  const tx = await contract.claim(
    signatureData.tweetHash,
    signatureData.deadline,
    signatureData.signature,
    {
      value: claimFee
    }
  );

  showMessage("Transaction submitted. Waiting for confirmation...", "ok");

  await tx.wait();

  return tx.hash;
}

async function recordClaim(activeWallet, taskId, txHash) {
  const response = await fetch("/api/claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "include",
    body: JSON.stringify({
      wallet: activeWallet,
      taskId: Number(taskId),
      txHash
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!data.success) {
    const error = new Error(data.error || data.detail || "Failed to record claim");
    error.responseData = data;
    throw error;
  }

  return data;
}

async function verifyAndClaim(task) {
  if (isVerifying) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  const latestTask = getLatestTask();

  if (!task || !task.id || !latestTask) {
    showMessage("Mission data missing. Please refresh and try again.", "err");
    return;
  }

  const progress = getProgressForTask(task);

  if (progress && progress.claimed) {
    showMessage("Latest mission already claimed.", "ok");
    renderMissions();
    return;
  }

  try {
    isVerifying = true;
    renderMissions();

    const taskId = Number(task.id);
    const tweetId = String(task.tweet_id);

    setCurrentOfficialTweetId(tweetId);

    showMessage("Checking latest X mission...");

    const verifyResponse = await fetch("/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        wallet: activeWallet,
        taskId
      })
    });

    const verifyData = await verifyResponse.json().catch(() => ({}));

    if (verifyData.tweetId || verifyData.latestTweetId) {
      setCurrentOfficialTweetId(verifyData.tweetId || verifyData.latestTweetId);
    }

    if (!verifyData.success) {
      if (needsXAuthorization(verifyData)) {
        clearXConnected(activeWallet);
        currentXConnected = false;

        updateWalletUI();
        renderMissions();

        redirectToXAuthorization(activeWallet, taskId);
        return;
      }

      if (shouldLockClaimButton(verifyData)) {
        showMessage(
          verifyData.message || verifyData.error || "Latest mission already claimed.",
          "ok"
        );

        await loadTasks(false);
        return;
      }

      const targetTweetId = String(verifyData.tweetId || verifyData.latestTweetId || tweetId);

      setCurrentOfficialTweetId(targetTweetId);

      showMessage(
        verifyData.message ||
          verifyData.error ||
          "Latest mission is not completed yet. Opening the exact X post...",
        "ok"
      );

      await loadTasks(false);

      setTimeout(() => {
        openTaskXDirect(targetTweetId);
      }, 800);

      return;
    }

    const verifiedTweetId = String(verifyData.tweetId || verifyData.latestTweetId || tweetId);
    const verifiedTaskId = verifyData.taskId || verifyData.latestTaskId || taskId;

    showMessage("Mission verified. Getting claim signature...", "ok");

    const signatureData = await getClaimSignature(
      activeWallet,
      verifiedTweetId
    );

    const txHash = await claimOnChain(signatureData, activeWallet);

    showMessage("On-chain claim confirmed. Recording claim...", "ok");

    await recordClaim(
      activeWallet,
      signatureData.taskId || verifiedTaskId,
      txHash
    );

    showMessage("Claim successful. Tokens sent to your wallet.", "ok");

    await loadTasks(false);
  } catch (error) {
    console.error(error);

    const responseData = error && error.responseData;
    const readableError = getReadableError(error);

    if (
      shouldLockClaimButton(responseData) ||
      String(readableError).toLowerCase().includes("already claimed")
    ) {
      showMessage("Latest mission already claimed.", "ok");
      await loadTasks(false);
    } else {
      showMessage("Claim failed: " + readableError, "err");
    }
  } finally {
    isVerifying = false;
    renderMissions();
  }
}

function handleReturnFromX() {
  const pendingOfficialX = localStorage.getItem("pending_official_x");
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (pendingOfficialX && activeWallet) {
    showMessage("Back from X? Tap Verify & Claim after following, liking, reposting, and commenting.", "ok");
  }
}

function handleUrlStatus() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("x_connected") === "1") {
    const walletFromUrl = params.get("wallet");
    const xUsernameFromUrl = params.get("x_username");

    showMessage("X connected. Complete the latest mission, then claim.", "ok");

    const activeWallet =
      walletFromUrl ||
      userAddress ||
      localStorage.getItem("wallet_address") ||
      localStorage.getItem("pending_x_wallet");

    if (activeWallet) {
      localStorage.setItem("wallet_connected", "true");
      localStorage.setItem("wallet_address", activeWallet);
      localStorage.setItem("pending_x_wallet", activeWallet);
      setXConnected(activeWallet);
      currentXConnected = true;
    }

    if (xUsernameFromUrl) {
      currentXUsername = xUsernameFromUrl;
      localStorage.setItem("x_username", xUsernameFromUrl);
    }

    const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  const xError = params.get("x_error");

  if (xError) {
    const errorMap = {
      already_bound: "This X account is already bound to another wallet.",
      missing_oauth_params: "Missing X authorization data. Please try Claim Reward again.",
      oauth_state_not_found: "X authorization expired or opened in another browser. Please try Claim Reward again.",
      oauth_expired: "X authorization expired. Please try Claim Reward again.",
      missing_wallet: "Missing wallet address. Please connect wallet and try again."
    };

    showMessage(errorMap[xError] || `X connection failed: ${xError}`, "err");

    const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  }
}

if (connectBtn) {
  connectBtn.addEventListener("click", connectWallet);
}

if (connectXBtn) {
  connectXBtn.addEventListener("click", connectX);
}

if (refreshMissionsBtn) {
  refreshMissionsBtn.addEventListener("click", () => {
    const activeWallet = userAddress || localStorage.getItem("wallet_address");

    if (activeWallet) {
      showMessage("Wallet already connected.", "ok");
      updateWalletUI();
      return;
    }

    connectWallet();
  });
}

if (menuBtn && navMenu) {
  menuBtn.addEventListener("click", () => {
    navMenu.classList.toggle("show");
  });

  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navMenu.classList.remove("show");
    });
  });
}

window.addEventListener("focus", () => {
  handleReturnFromX();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    handleReturnFromX();
  }
});

window.addEventListener("load", async () => {
  handleUrlStatus();

  updateWalletUI();
  renderMissions();

  await autoConnectWallet();

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (activeWallet) {
    await loadTasks(true);
  }

  listenWalletChange();
});

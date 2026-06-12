const BSC_CHAIN_ID_HEX = "0x38";
const BSC_CHAIN_ID_DEC = 56;

const BSC_RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc.publicnode.com",
  "https://rpc.ankr.com/bsc"
];

let provider = null;
let signer = null;
let userAddress = null;
let currentTasks = [];
let currentProgress = [];
let currentXConnected = false;
let currentXUsername = null;
let isLoadingTasks = false;
let isVerifying = false;

const connectBtn = document.getElementById("connectBtn");
const connectXBtn = document.getElementById("connectXBtn");
const refreshTasksBtn = document.getElementById("refreshTasksBtn");
const missionsList = document.getElementById("missionsList");
const message = document.getElementById("message");
const walletText = document.getElementById("walletText");
const xStatusText = document.getElementById("xStatusText");
const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");

function showMessage(text, type = "") {
  if (!message) return;

  message.innerText = text || "";
  message.classList.remove("ok", "err");

  if (type) {
    message.classList.add(type);
  }
}

function getReadableError(error) {
  if (!error) return "Unknown error";

  const rawMessage = [
    error.data && error.data.message,
    error.error && error.error.message,
    error.reason,
    error.message,
    String(error)
  ].filter(Boolean).join(" ");

  const lowerMessage = rawMessage.toLowerCase();

  if (error.code === 4001 || lowerMessage.includes("user rejected")) {
    return "User rejected the request.";
  }

  if (error.code === -32002 || lowerMessage.includes("already pending")) {
    return "Wallet request already pending. Please open your wallet.";
  }

  if (lowerMessage.includes("already claimed")) {
    return "Already claimed.";
  }

  if (lowerMessage.includes("insufficient funds")) {
    return "Insufficient BNB for gas.";
  }

  if (error.data && error.data.message) return error.data.message;
  if (error.error && error.error.message) return error.error.message;
  if (error.reason) return error.reason;
  if (error.message) return error.message;

  return String(error);
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";
}

function getWalletProvider() {
  if (window.okxwallet && window.okxwallet.ethereum) return window.okxwallet.ethereum;
  if (window.ethereum) return window.ethereum;
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
        params: [{
          chainId: BSC_CHAIN_ID_HEX,
          chainName: "BNB Smart Chain",
          nativeCurrency: {
            name: "BNB",
            symbol: "BNB",
            decimals: 18
          },
          rpcUrls: BSC_RPC_URLS,
          blockExplorerUrls: ["https://bscscan.com"]
        }]
      });
    } else {
      throw error;
    }
  }
}

function getXStorageKey(address) {
  return address ? `shit_x_connected_${address.toLowerCase()}` : "";
}

function isXConnected() {
  if (!userAddress) return false;
  return localStorage.getItem(getXStorageKey(userAddress)) === "true";
}

function setXConnected(address) {
  if (!address) return;
  localStorage.setItem(getXStorageKey(address), "true");
}

function clearUrlParams() {
  const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
  window.history.replaceState({}, document.title, cleanUrl);
}

function handleReturnFromX() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("x_connected") === "1") {
    const pendingWallet = localStorage.getItem("pending_x_wallet");

    if (pendingWallet) {
      setXConnected(pendingWallet);
      localStorage.removeItem("pending_x_wallet");
    }

    showMessage("X account connected. Open the mission post, comment, then verify.", "ok");
    clearUrlParams();
  }

  const xError = params.get("x_error");

  if (xError === "already_bound") {
    showMessage("This X account is already bound to another wallet.", "err");
    clearUrlParams();
  }
}

function updateWalletUI() {
  if (connectBtn) {
    connectBtn.innerText = userAddress ? shortAddress(userAddress) : "connect wallet";
  }

  if (walletText) {
    walletText.innerText = userAddress ? shortAddress(userAddress) : "Not connected";
  }

  const connectedX = isXConnected();

  if (xStatusText) {
    xStatusText.innerText = connectedX ? "Connected" : "Not connected";
  }

  if (connectXBtn) {
    connectXBtn.disabled = !userAddress;
    connectXBtn.innerText = connectedX ? "reconnect X" : "connect X";
  }

  if (refreshTasksBtn) {
    refreshTasksBtn.disabled = !userAddress;
  }
}

function resetWalletUI() {
  userAddress = null;
  provider = null;
  signer = null;
  currentTasks = [];
  currentProgress = [];

  localStorage.removeItem("wallet_connected");
  localStorage.removeItem("wallet_address");

  updateWalletUI();
  renderMissions();
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
  await loadTasks();
}

async function connectWallet() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    showMessage("Please open this page in MetaMask, OKX Wallet, TokenPocket, Trust Wallet or another Web3 wallet browser.", "err");
    return;
  }

  try {
    if (connectBtn) connectBtn.disabled = true;

    showMessage("Connecting wallet...");

    await switchToBSC();

    provider = new ethers.providers.Web3Provider(walletProvider, "any");
    await provider.send("eth_requestAccounts", []);

    await setupWalletAfterConnected();

    showMessage("Wallet connected. Now connect X and complete the mission.", "ok");
  } catch (error) {
    console.error(error);
    showMessage("Wallet connection failed: " + getReadableError(error), "err");
  } finally {
    if (connectBtn) connectBtn.disabled = false;
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

async function connectX() {
  if (!userAddress) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  localStorage.setItem("pending_x_wallet", userAddress.toLowerCase());
  window.location.href = `/api/auth/x/login?wallet=${encodeURIComponent(userAddress)}`;
}

function getProgressForTask(taskId) {
  return currentProgress.find((item) => Number(item.task_id) === Number(taskId));
}

function getMissionState(task) {
  const progress = getProgressForTask(task.id);

  if (progress && progress.claimed) {
    return {
      label: "Claimed",
      className: "claimed"
    };
  }

  if (progress && progress.claimable) {
    return {
      label: "Ready to claim",
      className: "ready"
    };
  }

  if (progress && progress.verified) {
    return {
      label: "Verified",
      className: "ready"
    };
  }

  return {
    label: "Not verified",
    className: "pending"
  };
}

async function loadTasks() {
  if (isLoadingTasks) return;

  isLoadingTasks = true;

  try {
    if (missionsList) {
      missionsList.innerHTML = `<div class="mission-card muted">Loading missions...</div>`;
    }

    const walletQuery = userAddress ? `?wallet=${encodeURIComponent(userAddress)}` : "";
    const response = await fetch(`/api/tasks${walletQuery}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to load missions");
    }

    currentTasks = data.tasks || [];
    currentProgress = data.progress || [];

    renderMissions();
  } catch (error) {
    console.error(error);

    if (missionsList) {
      missionsList.innerHTML = `<div class="mission-card muted">Failed to load missions. Please try again.</div>`;
    }

    showMessage("Load missions failed: " + getReadableError(error), "err");
  } finally {
    isLoadingTasks = false;
    updateWalletUI();
  }
}

function renderMissions() {
  if (!missionsList) return;

  if (!userAddress) {
    missionsList.innerHTML = `<div class="mission-card muted">Connect your wallet to load airdrop missions.</div>`;
    return;
  }

  if (!currentTasks.length) {
    missionsList.innerHTML = `<div class="mission-card muted">No active missions yet.</div>`;
    return;
  }

  missionsList.innerHTML = currentTasks.map((task) => {
    const state = getMissionState(task);
    const tweetUrl = `https://x.com/i/web/status/${task.tweet_id}`;
    const progress = getProgressForTask(task.id);
    const isClaimed = Boolean(progress && progress.claimed);

    return `
      <div class="mission-card">
        <div class="mission-top">
          <div>
            <strong>${escapeHtml(task.title || `Mission ${task.id}`)}</strong>
            <span>Reward: ${escapeHtml(task.reward_amount || "1")} drop</span>
          </div>
          <em class="${state.className}">${state.label}</em>
        </div>

        <p>
          Like, repost, and comment on the official X post. Then come back here
          and verify your mission.
        </p>

        <a class="mission-link" href="${tweetUrl}" target="_blank" rel="noopener noreferrer">
          ${tweetUrl}
        </a>

        <div class="mission-actions">
          <button class="btn full light" type="button" onclick="openXTask('${task.tweet_id}', ${task.id})">
            open X task
          </button>
          <button class="btn full gold" type="button" onclick="verifyAndClaim(${task.id})" ${isClaimed ? "disabled" : ""}>
            ${isClaimed ? "claimed" : "verify & claim"}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function copySuggestedComment() {
  const text = "I joined the $SHIT shitshow 💩";

  try {
    await navigator.clipboard.writeText(text);
    showMessage("Suggested comment copied. You can still write your own comment on X.", "ok");
  } catch (error) {
    showMessage("Open X and leave your own comment.", "ok");
  }
}

function openXTask(tweetId, taskId) {
  localStorage.setItem("pending_x_task_id", String(taskId));
  copySuggestedComment();

  const webUrl = `https://x.com/i/web/status/${tweetId}`;
  const userAgent = navigator.userAgent || "";

  if (/Android/i.test(userAgent)) {
    const fallbackUrl = encodeURIComponent(webUrl);
    window.location.href =
      `intent://x.com/i/web/status/${tweetId}` +
      `#Intent;scheme=https;package=com.twitter.android;` +
      `S.browser_fallback_url=${fallbackUrl};end`;
    return;
  }

  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    const startedAt = Date.now();
    window.location.href = `twitter://status?id=${tweetId}`;

    setTimeout(() => {
      if (Date.now() - startedAt < 1800) {
        window.location.href = webUrl;
      }
    }, 1200);

    return;
  }

  window.open(webUrl, "_blank", "noopener,noreferrer");
}

async function verifyAndClaim(taskId) {
  if (isVerifying) return;

  if (!userAddress) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  if (!isXConnected()) {
    showMessage("Please connect X first.", "err");
    return;
  }

  try {
    isVerifying = true;
    showMessage("Checking your X comment...");

    const verifyResponse = await fetch("/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet: userAddress,
        taskId
      })
    });

    const verifyData = await verifyResponse.json();

    if (!verifyResponse.ok || !verifyData.success) {
      throw new Error(verifyData.message || verifyData.error || "Mission not verified yet");
    }

    showMessage("Mission verified. Recording claim...", "ok");

    const claimResponse = await fetch("/api/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet: userAddress,
        taskId
      })
    });

    const claimData = await claimResponse.json();

    if (!claimResponse.ok || !claimData.success) {
      throw new Error(claimData.error || "Claim failed");
    }

    showMessage("Claim recorded. Your mission is complete.", "ok");
    await loadTasks();
  } catch (error) {
    console.error(error);
    showMessage(getReadableError(error), "err");
    await loadTasks();
  } finally {
    isVerifying = false;
  }
}

window.openXTask = openXTask;
window.verifyAndClaim = verifyAndClaim;

if (connectBtn) {
  connectBtn.addEventListener("click", connectWallet);
}

if (connectXBtn) {
  connectXBtn.addEventListener("click", connectX);
}

if (refreshTasksBtn) {
  refreshTasksBtn.addEventListener("click", loadTasks);
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

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && userAddress) {
    const pendingTaskId = localStorage.getItem("pending_x_task_id");

    if (pendingTaskId) {
      showMessage("Back from X? Tap verify & claim after liking, reposting, and commenting.", "ok");
      localStorage.removeItem("pending_x_task_id");
    }
  }
});

window.addEventListener("focus", () => {
  if (userAddress) {
    const pendingTaskId = localStorage.getItem("pending_x_task_id");

    if (pendingTaskId) {
      showMessage("Back from X? Tap verify & claim after liking, reposting, and commenting.", "ok");
      localStorage.removeItem("pending_x_task_id");
    }
  }
});

window.addEventListener("load", async () => {
  handleReturnFromX();
  renderMissions();
  await autoConnectWallet();
  listenWalletChange();
  updateWalletUI();
});

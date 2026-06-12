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

let isConnectingWallet = false;
let isLoadingTasks = false;
let isVerifying = false;

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

function getReadableError(error) {
  if (!error) return "Unknown error";

  const rawMessage = [
    error.data && error.data.message,
    error.error && error.error.message,
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

  if (error.data && error.data.message) return error.data.message;
  if (error.error && error.error.message) return error.error.message;
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
  return `x_connected_${String(address || "").toLowerCase()}`;
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
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) return false;

  if (currentXConnected) return true;

  return localStorage.getItem(getXStorageKey(activeWallet)) === "true";
}

function getTaskProgress(taskId) {
  return currentProgress.find((item) => Number(item.task_id) === Number(taskId));
}

function getFirstAvailableTask() {
  if (!currentTasks.length) return null;

  return currentTasks.find((task) => {
    const progress = getTaskProgress(task.id);
    return !(progress && progress.claimed);
  }) || currentTasks[0];
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
    refreshMissionsBtn.disabled = !activeWallet;
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

  localStorage.removeItem("wallet_connected");
  localStorage.removeItem("wallet_address");

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

  await loadTasks();
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
  } finally {
    isConnectingWallet = false;

    if (connectBtn) {
      connectBtn.disabled = false;
    }
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

function connectX() {
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  localStorage.setItem("pending_x_wallet", activeWallet);

  // After the user comes back to TokenPocket and taps refresh missions,
  // the page will automatically open the X mission post.
  localStorage.setItem("open_task_after_x_auth", "true");

  window.location.assign(`/api/auth/x/login?wallet=${encodeURIComponent(activeWallet)}`);
}

async function loadTasks() {
  if (isLoadingTasks) return;

  try {
    isLoadingTasks = true;

    if (refreshMissionsBtn) {
      refreshMissionsBtn.disabled = true;
      refreshMissionsBtn.innerText = "loading...";
    }

    const activeWallet = userAddress || localStorage.getItem("wallet_address") || "";
    const walletQuery = activeWallet ? `?wallet=${encodeURIComponent(activeWallet)}` : "";

    const response = await fetch(`/api/tasks${walletQuery}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.detail || data.error || "Failed to load missions");
    }

    currentTasks = data.tasks || [];
    currentProgress = data.progress || [];
    currentXConnected = Boolean(data.xConnected);
    currentXUsername = data.xUsername || null;

    if (currentXConnected && activeWallet) {
      setXConnected(activeWallet);
    }

    updateWalletUI();
    renderMissions();

    if (activeWallet && currentXConnected) {
      showMessage("X account connected. Opening the mission post...", "ok");

      const shouldOpenTask = localStorage.getItem("open_task_after_x_auth") === "true";

      if (shouldOpenTask) {
        localStorage.removeItem("open_task_after_x_auth");

        const firstTask = getFirstAvailableTask();

        if (firstTask && firstTask.tweet_id) {
          openXTask(firstTask.tweet_id);
        }
      }
    } else if (activeWallet && !currentXConnected) {
      showMessage("Wallet connected. Please connect X.", "err");
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
      refreshMissionsBtn.disabled = !activeWallet;
      refreshMissionsBtn.innerText = "refresh missions";
    }
  }
}

function getTaskUrl(tweetId) {
  return `https://x.com/i/web/status/${tweetId}`;
}

function getTaskStatus(progress) {
  if (!progress) {
    return {
      text: "Not verified",
      className: "not-verified"
    };
  }

  if (progress.claimed) {
    return {
      text: "Claimed",
      className: "claimed"
    };
  }

  if (progress.claimable || progress.verified) {
    return {
      text: "Ready",
      className: "ready"
    };
  }

  return {
    text: "Not verified",
    className: "not-verified"
  };
}

function renderMissions() {
  if (!missionList) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    missionList.innerHTML = `
      <div class="mission-card empty">
        <h3>Connect your wallet to load airdrop missions.</h3>
        <p>Use TokenPocket, MetaMask, OKX Wallet, Trust Wallet or another Web3 wallet browser.</p>
      </div>
    `;
    return;
  }

  if (!currentTasks.length) {
    missionList.innerHTML = `
      <div class="mission-card empty">
        <h3>No missions loaded</h3>
        <p>Tap refresh missions. If this stays empty, check /api/tasks.</p>
      </div>
    `;
    return;
  }

  missionList.innerHTML = currentTasks
    .map((task) => {
      const progress = getTaskProgress(task.id);
      const status = getTaskStatus(progress);
      const taskUrl = getTaskUrl(task.tweet_id);

      const verifyDisabled = progress && progress.claimed ? "disabled" : "";
      const verifyText = progress && progress.claimed ? "claimed" : "verify & claim";

      return `
        <div class="mission-card" data-task-id="${task.id}">
          <div class="mission-head">
            <div>
              <h3>${task.title || `Mission ${task.id}`}</h3>
              <p class="reward">Reward: ${task.reward_amount || "1"} drop</p>
            </div>
            <span class="mission-status ${status.className}">${status.text}</span>
          </div>

          <p>
            Like, repost, and comment on the official X post.
            Then come back here and verify your mission.
          </p>

          <a class="mission-link" href="${taskUrl}" target="_blank" rel="noopener noreferrer">
            ${taskUrl}
          </a>

          <div class="mission-actions">
            <button class="btn full light open-task-btn" type="button" data-tweet-id="${task.tweet_id}">
              open X task
            </button>

            <button class="btn full gold verify-task-btn" type="button" data-task-id="${task.id}" ${verifyDisabled}>
              ${verifyText}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  missionList.querySelectorAll(".open-task-btn").forEach((button) => {
    button.addEventListener("click", () => {
      openXTask(button.dataset.tweetId);
    });
  });

  missionList.querySelectorAll(".verify-task-btn").forEach((button) => {
    button.addEventListener("click", () => {
      verifyAndClaim(button.dataset.taskId);
    });
  });
}

function openXTask(tweetId) {
  if (!tweetId) {
    showMessage("Missing tweet ID.", "err");
    return;
  }

  localStorage.setItem("pending_x_task_id", String(tweetId));

  const webUrl = `https://x.com/i/web/status/${tweetId}`;
  const ua = navigator.userAgent || "";

  showMessage("Opening X. Like, repost, comment, then come back and tap verify.", "ok");

  // Android: try to open X app first, fallback to x.com web.
  if (/Android/i.test(ua)) {
    const fallbackUrl = encodeURIComponent(webUrl);

    window.location.href =
      `intent://x.com/i/web/status/${tweetId}` +
      `#Intent;scheme=https;package=com.twitter.android;` +
      `S.browser_fallback_url=${fallbackUrl};end`;

    return;
  }

  // iPhone / iPad: try Twitter/X app scheme first, fallback to x.com web.
  if (/iPhone|iPad|iPod/i.test(ua)) {
    window.location.href = `twitter://status?id=${tweetId}`;

    setTimeout(() => {
      window.location.href = webUrl;
    }, 1200);

    return;
  }

  window.open(webUrl, "_blank", "noopener,noreferrer");
}

async function verifyAndClaim(taskId) {
  if (isVerifying) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  try {
    isVerifying = true;

    showMessage("Checking X mission...");

    if (!isXConnected()) {
      await loadTasks();

      if (!isXConnected()) {
        showMessage(
          "Please connect X first. If you just authorized X, tap refresh missions and try again.",
          "err"
        );
        return;
      }
    }

    const verifyResponse = await fetch("/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet: activeWallet,
        taskId: Number(taskId)
      })
    });

    const verifyData = await verifyResponse.json();

    if (!verifyData.success) {
      showMessage(
        verifyData.message || verifyData.error || "Mission not verified yet. Please comment and try again.",
        "err"
      );
      await loadTasks();
      return;
    }

    showMessage("Mission verified. Recording claim...", "ok");

    const claimResponse = await fetch("/api/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet: activeWallet,
        taskId: Number(taskId),
        txHash: "offchain"
      })
    });

    const claimData = await claimResponse.json();

    if (!claimData.success) {
      if (claimData.error && claimData.error.toLowerCase().includes("already claimed")) {
        showMessage("Already claimed.", "ok");
      } else {
        showMessage(claimData.error || "Claim failed.", "err");
      }

      await loadTasks();
      return;
    }

    showMessage("Claim recorded. You are claimed for this mission.", "ok");

    await loadTasks();
  } catch (error) {
    console.error(error);
    showMessage("Verify failed: " + getReadableError(error), "err");
  } finally {
    isVerifying = false;
  }
}

function handleReturnFromX() {
  const pendingTask = localStorage.getItem("pending_x_task_id");
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (pendingTask && activeWallet) {
    showMessage("Back from X? Tap verify & claim after liking, reposting, and commenting.", "ok");
  }
}

function handleUrlStatus() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("x_connected") === "1") {
    showMessage("X connected. Open the mission post, comment, then verify.", "ok");

    const activeWallet =
      userAddress ||
      localStorage.getItem("wallet_address") ||
      localStorage.getItem("pending_x_wallet");

    if (activeWallet) {
      setXConnected(activeWallet);
    }

    const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  const xError = params.get("x_error");

  if (xError) {
    const errorMap = {
      already_bound: "This X account is already bound to another wallet.",
      missing_oauth_params: "Missing X authorization data. Please connect X again.",
      oauth_state_not_found: "X authorization expired or opened in another browser. Please connect X again.",
      oauth_expired: "X authorization expired. Please connect X again."
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
  refreshMissionsBtn.addEventListener("click", loadTasks);
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
    await loadTasks();
  }

  listenWalletChange();
});

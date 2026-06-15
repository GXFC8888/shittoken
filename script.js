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

  window.location.href = `/api/auth/x/login?wallet=${encodeURIComponent(activeWallet)}`;
}

async function loadTasks(runPendingVerify = true) {
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
      showMessage("X account connected. Open official X, finish one post, then verify.", "ok");

      const pendingVerify = localStorage.getItem("pending_official_verify") === "true";

      if (runPendingVerify && pendingVerify) {
        localStorage.removeItem("pending_official_verify");

        setTimeout(() => {
          verifyAndClaim();
        }, 600);
      }
    } else if (activeWallet && !currentXConnected) {
      showMessage("Wallet connected. Open official X, finish one post, then tap verify & claim.", "ok");
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

function getClaimedCount() {
  return currentProgress.filter((item) => item.claimed).length;
}

function renderMissions() {
  if (!missionList) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    missionList.innerHTML = `
      <div class="mission-card empty">
        <h3>Connect your wallet to load official X mission.</h3>
        <p>Use TokenPocket, MetaMask, OKX Wallet, Trust Wallet or another Web3 wallet browser.</p>
      </div>
    `;
    return;
  }

  const claimedCount = getClaimedCount();

  missionList.innerHTML = `
    <div class="mission-card" data-official-x="true">
      <div class="mission-head">
        <div>
          <h3>Official X Mission</h3>
          <p class="reward">Reward: 1 drop per official post</p>
        </div>
        <span class="mission-status ready">${claimedCount} claimed</span>
      </div>

      <p>
        Open @${OFFICIAL_X_USERNAME}, choose any official post, then like, repost,
        and comment on that post. Come back here and tap verify & claim.
        Each official post can be claimed once.
      </p>

      <a class="mission-link" href="${OFFICIAL_X_WEB_URL}" target="_blank" rel="noopener noreferrer">
        ${OFFICIAL_X_WEB_URL}
      </a>

      <div class="mission-actions">
        <button class="btn full light open-task-btn" type="button">
          open official X
        </button>

        <button class="btn full gold verify-task-btn" type="button">
          verify & claim
        </button>
      </div>
    </div>
  `;

  const openButton = missionList.querySelector(".open-task-btn");
  const verifyButton = missionList.querySelector(".verify-task-btn");

  if (openButton) {
    openButton.addEventListener("click", openOfficialX);
  }

  if (verifyButton) {
    verifyButton.addEventListener("click", () => {
      verifyAndClaim();
    });
  }
}

function openOfficialX() {
  localStorage.setItem("pending_official_x", "true");

  showMessage(
    `Opening @${OFFICIAL_X_USERNAME}. Like, repost, and comment on any official post, then come back and verify.`,
    "ok"
  );

  try {
    navigator.clipboard.writeText(OFFICIAL_X_WEB_URL).catch(() => {});
  } catch (error) {}

  let appOpened = false;

  const onVisibilityChange = () => {
    if (document.hidden) {
      appOpened = true;
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange, { once: true });

  window.location.href = OFFICIAL_X_APP_URL;

  setTimeout(() => {
    if (!appOpened) {
      window.location.href = OFFICIAL_X_WEB_URL;
    }
  }, 1800);
}

function needsXAuthorization(data) {
  const text = String(
    data && (data.message || data.error || data.detail || "")
  ).toLowerCase();

  return (
    text.includes("connect x") ||
    text.includes("please connect x") ||
    text.includes("x first") ||
    text.includes("x account")
  );
}

function redirectToXAuthorization(activeWallet) {
  localStorage.setItem("pending_official_verify", "true");
  localStorage.setItem("pending_x_wallet", activeWallet);

  showMessage("X authorization is required once. Redirecting to X...", "ok");

  setTimeout(() => {
    window.location.href = `/api/auth/x/login?wallet=${encodeURIComponent(activeWallet)}`;
  }, 300);
}

async function verifyAndClaim() {
  if (isVerifying) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  try {
    isVerifying = true;

    showMessage("Scanning official X posts...");

    const verifyResponse = await fetch("/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet: activeWallet
      })
    });

    const verifyData = await verifyResponse.json().catch(() => ({}));

    if (!verifyData.success) {
      if (needsXAuthorization(verifyData) || verifyResponse.status === 400) {
        redirectToXAuthorization(activeWallet);
        return;
      }

      showMessage(
        verifyData.message || verifyData.error || "No completed unclaimed official post found. Please try again.",
        "err"
      );

      await loadTasks(false);
      return;
    }

    if (!verifyData.taskId) {
      showMessage("Verified, but missing task ID. Please refresh and try again.", "err");
      await loadTasks(false);
      return;
    }

    showMessage("Official post verified. Recording claim...", "ok");

    const claimResponse = await fetch("/api/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet: activeWallet,
        taskId: Number(verifyData.taskId),
        txHash: "offchain"
      })
    });

    const claimData = await claimResponse.json().catch(() => ({}));

    if (!claimData.success) {
      if (claimData.error && claimData.error.toLowerCase().includes("already claimed")) {
        showMessage("Already claimed.", "ok");
      } else {
        showMessage(claimData.error || "Claim failed.", "err");
      }

      await loadTasks(false);
      return;
    }

    showMessage("Claim recorded for one official post.", "ok");

    await loadTasks(false);
  } catch (error) {
    console.error(error);
    showMessage("Verify failed: " + getReadableError(error), "err");
  } finally {
    isVerifying = false;
  }
}

function handleReturnFromX() {
  const pendingOfficialX = localStorage.getItem("pending_official_x");
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (pendingOfficialX && activeWallet) {
    showMessage("Back from X? Tap verify & claim after liking, reposting, and commenting.", "ok");
  }
}

function handleUrlStatus() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("x_connected") === "1") {
    showMessage("X connected. Tap refresh missions to continue.", "ok");

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
      missing_oauth_params: "Missing X authorization data. Please try verify & claim again.",
      oauth_state_not_found: "X authorization expired or opened in another browser. Please try verify & claim again.",
      oauth_expired: "X authorization expired. Please try verify & claim again."
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
    loadTasks(true);
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

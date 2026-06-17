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
let localClaimLocked = false;

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
    refreshMissionsBtn.innerText = "Connect Wallet";
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
  localClaimLocked = false;

  localStorage.removeItem("wallet_connected");
  localStorage.removeItem("wallet_address");
  localStorage.removeItem("pending_official_verify");
  localStorage.removeItem("pending_official_x");
  localStorage.removeItem("pending_x_wallet");
  localStorage.removeItem("x_username");

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
        localClaimLocked = false;
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
      }
    }

    updateWalletUI();
    renderMissions();

    if (activeWallet && currentXConnected) {
      showMessage("X account connected. Open official X, finish the latest post, then verify.", "ok");

      const pendingVerify = localStorage.getItem("pending_official_verify") === "true";

      if (runPendingVerify && pendingVerify && !localClaimLocked) {
        localStorage.removeItem("pending_official_verify");

        setTimeout(() => {
          verifyAndClaim();
        }, 600);
      }
    } else if (activeWallet && !currentXConnected) {
      showMessage("Wallet connected. Open official X, finish the latest post, then tap Claim Reward.", "ok");
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
      refreshMissionsBtn.innerText = "Connect Wallet";
      refreshMissionsBtn.disabled = Boolean(activeWallet);
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
  const displayClaimedCount = localClaimLocked ? Math.max(claimedCount, 1) : claimedCount;
  const connectedX = isXConnected();
  const openXDisabled = connectedX;
  const verifyDisabled = localClaimLocked || isVerifying;
  const verifyButtonText = localClaimLocked ? "claimed" : isVerifying ? "checking..." : "Claim Reward";

  missionList.innerHTML = `
    <div class="mission-card" data-official-x="true">
      <div class="mission-head">
        <div>
          <h3>Official X Mission</h3>
          <p class="reward">Reward: 1 drop for the latest official post</p>
        </div>
        <span class="mission-status ready">${displayClaimedCount} claimed</span>
      </div>

      <p>
        Follow @${OFFICIAL_X_USERNAME}, like, repost, and comment on the latest official post.
        Come back here and tap Claim Reward.
        Only the latest official post can be claimed once.
      </p>

      <a class="mission-link" href="${OFFICIAL_X_WEB_URL}" target="_blank" rel="noopener noreferrer">
        ${OFFICIAL_X_WEB_URL}
      </a>

      <div class="mission-actions">
        <button class="btn full light open-task-btn" type="button" ${openXDisabled ? "disabled" : ""}>
          Open X
        </button>

        <button class="btn full gold verify-task-btn" type="button" ${verifyDisabled ? "disabled" : ""}>
          ${verifyButtonText}
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
      if (localClaimLocked) {
        showMessage("This post has already been claimed.", "ok");
        return;
      }

      verifyAndClaim();
    });
  }
}

function openOfficialX() {
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  localStorage.setItem("pending_official_x", "true");

  if (!isXConnected()) {
    localStorage.setItem("pending_x_wallet", activeWallet);

    showMessage("X authorization is required first. Redirecting to X...", "ok");

    setTimeout(() => {
      window.location.href = `/api/auth/x/login?wallet=${encodeURIComponent(activeWallet)}`;
    }, 300);

    return;
  }

  openOfficialXDirect();
}

function openOfficialXDirect() {
  localStorage.setItem("pending_official_x", "true");

  showMessage(
    `Opening @${OFFICIAL_X_USERNAME}. Follow, like, repost, and comment on the latest official post, then manually return here to claim.`,
    "ok"
  );

  try {
    navigator.clipboard.writeText(OFFICIAL_X_WEB_URL).catch(() => {});
  } catch (error) {}

  const userAgent = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);

  const twitterAppUrl = `twitter://user?screen_name=${OFFICIAL_X_USERNAME}`;
  const webUrl = OFFICIAL_X_WEB_URL;

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
    window.location.href = twitterAppUrl;

    setTimeout(() => {
      if (!appOpened) {
        window.location.href = webUrl;
      }
    }, 3200);

    return;
  }

  window.location.href = twitterAppUrl;

  setTimeout(() => {
    if (!appOpened) {
      window.location.href = webUrl;
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

function redirectToXAuthorization(activeWallet) {
  localStorage.setItem("pending_official_verify", "true");
  localStorage.setItem("pending_x_wallet", activeWallet);

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
    body: JSON.stringify({
      wallet: activeWallet,
      tweetId
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

async function verifyAndClaim() {
  if (isVerifying || localClaimLocked) {
    if (localClaimLocked) {
      showMessage("This post has already been claimed.", "ok");
    }

    return;
  }

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showMessage("Please connect wallet first.", "err");
    return;
  }

  try {
    isVerifying = true;
    renderMissions();

    showMessage("Scanning latest official X post...");

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
      if (needsXAuthorization(verifyData)) {
        clearXConnected(activeWallet);
        currentXConnected = false;

        showMessage(
          "X authorization is required. Redirecting to X...",
          "ok"
        );

        updateWalletUI();
        renderMissions();

        setTimeout(() => {
          redirectToXAuthorization(activeWallet);
        }, 800);

        return;
      }

      if (shouldLockClaimButton(verifyData)) {
        localClaimLocked = true;

        showMessage(
          verifyData.message || verifyData.error || "Latest official post already claimed.",
          "ok"
        );

        renderMissions();
        return;
      }

      showMessage(
        "Latest official post is not completed yet. Opening official X...",
        "ok"
      );

      setTimeout(() => {
        openOfficialXDirect();
      }, 800);

      return;
    }

    if (!verifyData.taskId || !verifyData.tweetId) {
      showMessage("Verified, but missing claim data. Please refresh and try again.", "err");
      await loadTasks(false);
      return;
    }

    showMessage("Latest official post verified. Getting claim signature...", "ok");

    const signatureData = await getClaimSignature(
      activeWallet,
      verifyData.tweetId
    );

    const txHash = await claimOnChain(signatureData, activeWallet);

    showMessage("On-chain claim confirmed. Recording claim...", "ok");

    await recordClaim(
      activeWallet,
      signatureData.taskId || verifyData.taskId,
      txHash
    );

    localClaimLocked = true;

    showMessage("Claim successful. Tokens sent to your wallet.", "ok");

    renderMissions();

    await loadTasks(false);
  } catch (error) {
    console.error(error);

    const responseData = error && error.responseData;
    const readableError = getReadableError(error);

    if (
      shouldLockClaimButton(responseData) ||
      String(readableError).toLowerCase().includes("already claimed")
    ) {
      localClaimLocked = true;
      showMessage("Latest official post already claimed.", "ok");
      renderMissions();
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

  if (pendingOfficialX && activeWallet && !localClaimLocked) {
    showMessage("Back from X? Tap Claim Reward after following, liking, reposting, and commenting.", "ok");
  }
}

function handleUrlStatus() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("x_connected") === "1") {
    const walletFromUrl = params.get("wallet");
    const xUsernameFromUrl = params.get("x_username");

    showMessage("X connected. Open official X, finish the latest post, then claim.", "ok");

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

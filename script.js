const ETHEREUM_MAINNET_CHAIN_ID_HEX = "0x1";

const FALLBACK_OFFICIAL_X_USERNAME = "gxfcrs";
let OFFICIAL_X_USERNAME = FALLBACK_OFFICIAL_X_USERNAME;

const REFERRAL_AIRDROP_CONTRACT = "0x1BcbC7eEa6983742d6302E9D82D370Cf0E6B4C7C";

const TOKEN_CONTRACT_ADDRESS = "0xe198cab05ddd117c6b4f67e24e329f2730c13dd3";

const HERO_CONTRACT_ADDRESS = "0x6b036CB8165aF95847Cb286Eca5e837EABf1842C";

function formatContractAddress(address, visiblePrefixLength = 10) {
  return `${address.slice(0, visiblePrefixLength)}...${address.slice(-4)}`;
}

const DISPLAY_TOKEN_CONTRACT_ADDRESS = formatContractAddress(
  TOKEN_CONTRACT_ADDRESS,
);
const DISPLAY_HERO_CONTRACT_ADDRESS = formatContractAddress(
  HERO_CONTRACT_ADDRESS,
  9,
);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const REFERRAL_AIRDROP_ABI = [
  "function claim(address referrer) payable",
  "function claimFee() view returns (uint256)",
  "function claimed(address user) view returns (bool)",
];

const TWITTER_TASK_CLAIM_ABI = [
  "function claim(bytes32 tweetHash, uint256 deadline, bytes signature) payable",
  "function claimFee() view returns (uint256)",
  "function claimAmount() view returns (uint256)",
  "function signer() view returns (address)",
  "function isClaimed(address user, bytes32 tweetHash) view returns (bool)",
];

let provider = null;
let signer = null;
let userAddress = null;

let currentTasks = [];
let currentProgress = [];
let currentXConnected = false;
let currentXUsername = null;
let pendingXCallback = null;

const X_BINDING_CONFLICT_STORAGE_PREFIX = "x_binding_conflict_";

let isConnectingWallet = false;
let isLoadingTasks = false;
let isVerifying = false;
let taskLoadRequestId = 0;
let activeTaskLoadCount = 0;
let isRefreshingAfterX = false;

let noNewMissionLocked = false;
let noNewMissionTaskId = null;

let currentTweetId = localStorage.getItem("current_official_tweet_id") || null;

function normalizeXUsername(value) {
  const username = String(value || "")
    .trim()
    .replace(/^@+/, "");

  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : "";
}

function normalizeTaskRecord(task) {
  if (!task || typeof task !== "object") return null;

  const id = Number(task.id);
  const tweetId = String(task.tweet_id || "").trim();

  if (!Number.isSafeInteger(id) || id <= 0 || !/^\d{1,30}$/.test(tweetId)) {
    return null;
  }

  return {
    ...task,
    id,
    tweet_id: tweetId,
  };
}

const connectBtn = document.getElementById("connectBtn");
const missionList = document.getElementById("missionList");
const xTaskButtonArea = document.getElementById("xTaskButtonArea");
const message = document.getElementById("message");
const walletText = document.getElementById("walletText");
const xStatusText = document.getElementById("xStatusText");
const xProfileAppBtn = document.getElementById("xProfileAppBtn");
const communityXAppBtn = document.getElementById("communityXAppBtn");

const refLinkInput = document.getElementById("refLink");
const copyRefBtn = document.getElementById("copyRefBtn");
const copyRefBtnMobile = document.getElementById("copyRefBtnMobile");
const claimReferralBtn = document.getElementById("claimReferralBtn");
const refMessage = document.getElementById("refMessage");
const copyHeroContractBtn = document.getElementById("copyHeroContractBtn");
const heroContractAddressText = document.getElementById("heroContractAddress");
const contractAddressInput = document.getElementById("contractAddress");
const copyContractBtn = document.getElementById("copyContractBtn");

const COMING_SOON_TEXT =
  "$SHIT is still in the airdrop phase. Trading has not launched yet.";

let isShowingComingSoonAlert = false;
let customAlertReturnFocus = null;

function closeCustomAlert() {
  const alertBox = document.getElementById("customAlert");

  if (!alertBox) return;

  alertBox.classList.add("hidden");
  isShowingComingSoonAlert = false;

  if (
    customAlertReturnFocus &&
    typeof customAlertReturnFocus.focus === "function"
  ) {
    customAlertReturnFocus.focus();
  }

  customAlertReturnFocus = null;
}

function showCustomAlert(text) {
  const alertBox = document.getElementById("customAlert");
  const alertText = document.getElementById("customAlertText");
  const alertOk = document.getElementById("customAlertOk");

  if (!alertBox || !alertText || !alertOk) {
    showMessage(text, "ok");
    isShowingComingSoonAlert = false;
    return;
  }

  alertText.innerText = text;
  customAlertReturnFocus = document.activeElement;
  alertBox.classList.remove("hidden");
  alertOk.focus();

  alertOk.onclick = closeCustomAlert;

  alertBox.onclick = (event) => {
    if (event.target === alertBox) {
      closeCustomAlert();
    }
  };
}

function bindComingSoonLinks() {
  document
    .querySelectorAll(".coming-soon-link")
    .forEach((link) => {
      if (link.dataset.boundComingSoon === "true") return;

      link.dataset.boundComingSoon = "true";

      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (isShowingComingSoonAlert) return;

        isShowingComingSoonAlert = true;

        showCustomAlert(COMING_SOON_TEXT);
      });
    });
}

function showMessage() {}

function showRefMessage(text, type) {
  if (!refMessage) return;

  refMessage.innerText = text || "";
  refMessage.classList.remove("ok", "err");

  if (type === "ok") {
    refMessage.classList.add("ok");
  }

  if (type === "err") {
    refMessage.classList.add("err");
  }
}

async function copyTextFallback(text) {
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }

  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Copy failed");
  }
}

async function copyText(text) {
  if (
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  await copyTextFallback(text);
}

async function copyContractAddress(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const cleanAddress = TOKEN_CONTRACT_ADDRESS;

  if (!cleanAddress) {
    return;
  }

  try {
    await copyText(cleanAddress);

    if (copyContractBtn) {
      const originalAriaLabel =
        copyContractBtn.getAttribute("aria-label") || "Copy contract address";

      copyContractBtn.classList.add("is-copied");
      copyContractBtn.setAttribute("aria-label", "Contract address copied");

      window.setTimeout(() => {
        copyContractBtn.classList.remove("is-copied");
        copyContractBtn.setAttribute("aria-label", originalAriaLabel);
      }, 1500);
    }
  } catch (error) {
    console.error("Copy contract address failed:", error);

    if (
      contractAddressInput &&
      typeof contractAddressInput.select === "function"
    ) {
      contractAddressInput.focus();
      contractAddressInput.select();

      if (typeof contractAddressInput.setSelectionRange === "function") {
        contractAddressInput.setSelectionRange(
          0,
          String(contractAddressInput.value || "").length,
        );
      }
    }
  }
}

async function copyHeroContractAddress(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  try {
    await copyText(HERO_CONTRACT_ADDRESS);

    if (copyHeroContractBtn) {
      const originalAriaLabel =
        copyHeroContractBtn.getAttribute("aria-label") ||
        "Copy contract address";

      copyHeroContractBtn.classList.add("is-copied");
      copyHeroContractBtn.setAttribute("aria-label", "Contract address copied");

      window.setTimeout(() => {
        copyHeroContractBtn.classList.remove("is-copied");
        copyHeroContractBtn.setAttribute("aria-label", originalAriaLabel);
      }, 1500);
    }
  } catch (error) {
    console.error("Copy hero contract address failed:", error);
  }
}

function getRefParam() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("ref") || params.get("r") || "";

  return ethers.utils.isAddress(value)
    ? ethers.utils.getAddress(value)
    : ZERO_ADDRESS;
}

function getReferralLink(address) {
  const cleanUrl = `${window.location.origin}${window.location.pathname}`;

  return address ? `${cleanUrl}?ref=${address}` : `${cleanUrl}?ref=YOURID`;
}

function updateReferralUI() {
  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (refLinkInput) {
    refLinkInput.value = getReferralLink(activeWallet);
  }

  if (claimReferralBtn) {
    claimReferralBtn.disabled = !activeWallet;
  }
}

function shortAddress(address) {
  return address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Not connected";
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

function isValidWalletAddress(address) {
  return /^0x[a-f0-9]{40}$/i.test(String(address || "").trim());
}

function clearWalletTaskState() {
  taskLoadRequestId += 1;
  currentProgress = [];
  currentXConnected = false;
  currentXUsername = null;
  noNewMissionLocked = false;
  noNewMissionTaskId = null;
}

function setCurrentTweetId(tweetId) {
  if (!tweetId) return;

  currentTweetId = String(tweetId);

  localStorage.setItem("current_official_tweet_id", currentTweetId);
}

function clearPendingXState() {
  localStorage.removeItem("pending_official_x");
  localStorage.removeItem("pending_official_verify");
  localStorage.removeItem("pending_verify_task_id");
  localStorage.removeItem("pending_open_tweet_id");
  localStorage.removeItem("pending_x_wallet");
}

function getXBindingConflictStorageKey(address) {
  return `${X_BINDING_CONFLICT_STORAGE_PREFIX}${normalizeWallet(address)}`;
}

function setXBindingConflict(address, boundWalletHint) {
  if (!address) return;

  try {
    sessionStorage.setItem(
      getXBindingConflictStorageKey(address),
      String(boundWalletHint || "the original wallet"),
    );
  } catch (error) {
    console.warn("Unable to save X binding conflict state:", error);
  }
}

function clearXBindingConflict(address) {
  if (!address) return;

  try {
    sessionStorage.removeItem(getXBindingConflictStorageKey(address));
  } catch (error) {
    console.warn("Unable to clear X binding conflict state:", error);
  }
}

function getXBindingConflict(address) {
  if (!address) return null;

  try {
    const boundWalletHint = sessionStorage.getItem(
      getXBindingConflictStorageKey(address),
    );

    return boundWalletHint
      ? {
          attemptedWallet: normalizeWallet(address),
          boundWalletHint,
        }
      : null;
  } catch (error) {
    return null;
  }
}

function getXBindingConflictMessage(conflict) {
  const boundWalletHint =
    conflict && conflict.boundWalletHint
      ? conflict.boundWalletHint
      : "the original wallet";

  return `This X account is permanently linked to wallet ${boundWalletHint}. Please switch back to that wallet.`;
}

function getLatestTask() {
  if (!currentTasks.length) return null;

  return (
    [...currentTasks]
      .filter((task) => task && task.active !== false)
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
      .at(-1) || null
  );
}

function getXTargetUrl(tweetId = null) {
  const latestTask = getLatestTask();

  const id =
    tweetId ||
    currentTweetId ||
    (latestTask ? String(latestTask.tweet_id) : null);

  return id
    ? `https://x.com/${OFFICIAL_X_USERNAME}/status/${id}`
    : `https://x.com/${OFFICIAL_X_USERNAME}`;
}

function getXTargetAppUrl(tweetId = null) {
  const latestTask = getLatestTask();

  const id =
    tweetId ||
    currentTweetId ||
    (latestTask ? String(latestTask.tweet_id) : null);

  return id
    ? `twitter://status?id=${id}`
    : `twitter://user?screen_name=${OFFICIAL_X_USERNAME}`;
}

function openOfficialXProfileInApp() {
  const targetAppUrl = `twitter://user?screen_name=${OFFICIAL_X_USERNAME}`;

  const targetWebUrl = `https://x.com/${OFFICIAL_X_USERNAME}`;

  let appOpened = false;

  const onVisibilityChange = () => {
    if (document.hidden) {
      appOpened = true;
    }
  };

  const onPageHide = () => {
    appOpened = true;
  };

  document.addEventListener("visibilitychange", onVisibilityChange, {
    once: true,
  });

  window.addEventListener("pagehide", onPageHide, { once: true });

  window.location.href = targetAppUrl;

  setTimeout(() => {
    if (!appOpened) {
      window.location.href = targetWebUrl;
    }
  }, 1800);
}

function getReadableError(error) {
  if (!error) {
    return "Unknown error";
  }

  const rawMessage = [
    error.data && error.data.message,
    error.error && error.error.message,
    error.responseData && error.responseData.message,
    error.responseData && error.responseData.error,
    error.responseData && error.responseData.detail,
    error.reason,
    error.message,
    String(error),
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
    return "Insufficient ETH for gas.";
  }

  if (lowerMessage.includes("already claimed")) {
    return "Already claimed.";
  }

  if (lowerMessage.includes("insufficient fee")) {
    return "Insufficient ETH fee.";
  }

  if (lowerMessage.includes("invalid signer")) {
    return "Invalid claim signature.";
  }

  if (lowerMessage.includes("signature expired")) {
    return "Claim signature expired. Please verify again.";
  }

  if (error.data && error.data.message) {
    return error.data.message;
  }

  if (error.error && error.error.message) {
    return error.error.message;
  }

  if (error.responseData && error.responseData.detail) {
    return error.responseData.detail;
  }

  if (error.responseData && error.responseData.error) {
    return error.responseData.error;
  }

  if (error.responseData && error.responseData.message) {
    return error.responseData.message;
  }

  if (error.reason) {
    return error.reason;
  }

  if (error.message) {
    return error.message;
  }

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

async function switchToEthereumMainnet() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    throw new Error("No wallet provider found");
  }

  try {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [
        {
          chainId: ETHEREUM_MAINNET_CHAIN_ID_HEX,
        },
      ],
    });
  } catch (error) {
    if (error && error.code === 4902) {
      throw new Error("Ethereum Mainnet is not available in this wallet.");
    }

    throw error;
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
    connectBtn.innerText = activeWallet
      ? shortAddress(activeWallet)
      : "Link wallet";

    connectBtn.disabled = false;
  }

  if (walletText) {
    walletText.innerText = activeWallet
      ? shortAddress(activeWallet)
      : "Not connected";
  }

  if (xStatusText) {
    xStatusText.innerText = connectedX
      ? currentXUsername
        ? `@${currentXUsername}`
        : ""
      : "Not connected";
  }

  updateReferralUI();
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

  currentTweetId = null;
  noNewMissionLocked = false;
  noNewMissionTaskId = null;

  [
    "wallet_connected",
    "wallet_address",
    "pending_official_verify",
    "pending_verify_task_id",
    "pending_official_x",
    "pending_open_tweet_id",
    "pending_x_wallet",
    "x_username",
    "current_official_tweet_id",
  ].forEach((key) => {
    localStorage.removeItem(key);
  });

  if (oldWallet) {
    clearXConnected(oldWallet);
  }

  updateWalletUI();
  renderMissions();
  showMessage("");
}

async function setupWalletAfterConnected(runPendingActions = false) {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    throw new Error("No wallet provider found");
  }

  provider = new ethers.providers.Web3Provider(walletProvider, "any");

  signer = provider.getSigner();
  const nextAddress = await signer.getAddress();
  const previousAddress =
    userAddress || localStorage.getItem("wallet_address") || "";
  const walletChanged =
    previousAddress &&
    normalizeWallet(previousAddress) !== normalizeWallet(nextAddress);

  clearWalletTaskState();
  userAddress = nextAddress;

  if (walletChanged) {
    clearPendingXState();
  }

  localStorage.setItem("wallet_connected", "true");

  localStorage.setItem("wallet_address", userAddress);

  if (pendingXCallback && pendingXCallback.wallet) {
    if (
      normalizeWallet(pendingXCallback.wallet) === normalizeWallet(userAddress)
    ) {
      clearXBindingConflict(userAddress);
    } else {
      setXBindingConflict(
        userAddress,
        shortAddress(pendingXCallback.wallet),
      );
    }
  }

  updateWalletUI();
  renderMissions();

  await loadTasks(runPendingActions);
}

async function connectWallet() {
  if (isConnectingWallet) return;

  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    showMessage(
      "Please open this page in TokenPocket, MetaMask, OKX Wallet, Trust Wallet or another Web3 wallet browser.",
      "err",
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

    await switchToEthereumMainnet();

    provider = new ethers.providers.Web3Provider(walletProvider, "any");

    await provider.send("eth_requestAccounts", []);

    await setupWalletAfterConnected();

    showMessage("Wallet connected.", "ok");
  } catch (error) {
    console.error(error);

    showMessage("Wallet connection failed: " + getReadableError(error), "err");

    if (connectBtn) {
      connectBtn.innerText = "Link wallet";
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

  if (!walletProvider) return false;

  if (localStorage.getItem("wallet_connected") !== "true") {
    return false;
  }

  try {
    const accounts = await walletProvider.request({
      method: "eth_accounts",
    });

    if (!accounts || accounts.length === 0) {
      resetWalletUI();
      return false;
    }

    await switchToEthereumMainnet();
    await setupWalletAfterConnected(true);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function listenWalletChange() {
  const walletProvider = getWalletProvider();

  if (!walletProvider || !walletProvider.on) {
    return;
  }

  walletProvider.on("accountsChanged", async (accounts) => {
    if (accounts && accounts.length > 0) {
      try {
        currentTweetId = null;
        noNewMissionLocked = false;
        noNewMissionTaskId = null;

        localStorage.removeItem("current_official_tweet_id");

        clearPendingXState();

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

async function copyReferralLink() {
  const link = refLinkInput
    ? refLinkInput.value
    : getReferralLink(userAddress || localStorage.getItem("wallet_address"));

  try {
    await copyText(link);

    showRefMessage("Referral link copied.", "ok");
  } catch (error) {
    showRefMessage("Copy failed. Please copy the link manually.", "err");
  }
}

async function claimReferralAirdrop() {
  if (isVerifying) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    showRefMessage("Please connect wallet first.", "err");

    return;
  }

  try {
    if (claimReferralBtn) {
      claimReferralBtn.disabled = true;
      claimReferralBtn.innerText = "claiming...";
    }

    showRefMessage("Preparing referral airdrop claim...", "ok");

    const walletProvider = getWalletProvider();

    if (!walletProvider) {
      throw new Error("No wallet provider found");
    }

    await switchToEthereumMainnet();

    const web3Provider = new ethers.providers.Web3Provider(
      walletProvider,
      "any",
    );

    const web3Signer = web3Provider.getSigner();

    const connectedAddress = await web3Signer.getAddress();

    if (connectedAddress.toLowerCase() !== activeWallet.toLowerCase()) {
      throw new Error("Connected wallet does not match current wallet");
    }

    const contract = new ethers.Contract(
      REFERRAL_AIRDROP_CONTRACT,
      REFERRAL_AIRDROP_ABI,
      web3Signer,
    );

    const alreadyClaimed = await contract.claimed(activeWallet);

    if (alreadyClaimed) {
      showRefMessage(
        "This wallet has already claimed the referral airdrop.",
        "ok",
      );

      return;
    }

    let referrer = getRefParam();

    if (referrer.toLowerCase() === activeWallet.toLowerCase()) {
      referrer = ZERO_ADDRESS;
    }

    const claimFee = await contract.claimFee();

    showRefMessage(
      "Please confirm the referral airdrop transaction in your wallet.",
      "ok",
    );

    const tx = await contract.claim(referrer, {
      value: claimFee,
    });

    showRefMessage("Transaction submitted. Waiting for confirmation...", "ok");

    await tx.wait();

    showRefMessage("Referral airdrop claimed successfully.", "ok");
  } catch (error) {
    console.error(error);

    showRefMessage("Referral claim failed: " + getReadableError(error), "err");
  } finally {
    if (claimReferralBtn) {
      claimReferralBtn.innerText = "Claim Airdrop";
    }

    updateReferralUI();
  }
}

async function loadTasks(runPendingActions = true) {
  const requestId = ++taskLoadRequestId;
  const requestWallet = normalizeWallet(
    userAddress || localStorage.getItem("wallet_address") || "",
  );

  try {
    activeTaskLoadCount += 1;
    isLoadingTasks = true;

    const params = new URLSearchParams();

    if (requestWallet) {
      params.set("wallet", requestWallet);
    }

    params.set("_t", String(Date.now()));

    const response = await fetch(`/api/tasks?${params.toString()}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));

    if (!data.success) {
      throw new Error(data.detail || data.error || "Failed to load missions");
    }

    const activeWalletNow = normalizeWallet(
      userAddress || localStorage.getItem("wallet_address") || "",
    );

    if (requestId !== taskLoadRequestId || activeWalletNow !== requestWallet) {
      return false;
    }

    const configuredOfficialUsername = normalizeXUsername(
      data.officialXUsername,
    );

    OFFICIAL_X_USERNAME =
      configuredOfficialUsername || FALLBACK_OFFICIAL_X_USERNAME;

    currentTasks = Array.isArray(data.tasks)
      ? data.tasks.map(normalizeTaskRecord).filter(Boolean)
      : [];

    currentProgress = Array.isArray(data.progress) ? data.progress : [];

    currentXConnected = Boolean(data.xConnected);

    currentXUsername = data.xUsername || null;

    const latestTask = getLatestTask();

    if (latestTask && latestTask.tweet_id) {
      setCurrentTweetId(latestTask.tweet_id);

      if (
        noNewMissionTaskId &&
        Number(noNewMissionTaskId) !== Number(latestTask.id)
      ) {
        noNewMissionLocked = false;
        noNewMissionTaskId = null;
      }
    }

    if (requestWallet) {
      if (currentXConnected) {
        setXConnected(requestWallet);
        clearXBindingConflict(requestWallet);

        if (currentXUsername) {
          localStorage.setItem("x_username", currentXUsername);
        }
      } else {
        clearXConnected(requestWallet);

        localStorage.removeItem("x_username");

        localStorage.removeItem("pending_official_verify");

        localStorage.removeItem("pending_verify_task_id");
      }
    }

    updateWalletUI();
    renderMissions();

    const latestProgress = getLatestTaskProgress();

    if (latestProgress && latestProgress.claimed) {
      clearPendingXState();
    }

    if (requestWallet && currentXConnected) {
      showMessage("");
    } else if (requestWallet && !currentXConnected) {
      showMessage("", "ok");
    } else {
      showMessage("Connect your wallet to load missions.", "err");
    }

    return true;
  } catch (error) {
    if (requestId !== taskLoadRequestId) {
      return false;
    }

    console.error(error);

    showMessage("Load missions failed: " + getReadableError(error), "err");
    return false;
  } finally {
    activeTaskLoadCount = Math.max(0, activeTaskLoadCount - 1);
    isLoadingTasks = activeTaskLoadCount > 0;
  }
}

function getTaskById(taskId) {
  return (
    currentTasks.find((item) => Number(item.id) === Number(taskId)) || null
  );
}

function isLatestTask(task) {
  const latestTask = getLatestTask();

  return Boolean(
    task && latestTask && Number(task.id) === Number(latestTask.id),
  );
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

  return getProgressByTaskId(task.id) || getProgressByTweetId(task.tweet_id);
}

function getLatestTaskProgress() {
  const latestTask = getLatestTask();

  return latestTask ? getProgressForTask(latestTask) : null;
}

function clearXTaskButtonArea() {
  if (xTaskButtonArea) {
    xTaskButtonArea.innerHTML = "";
  }
}

function moveMissionButtonsToButtonArea() {
  if (!xTaskButtonArea || !missionList) {
    return;
  }

  const actions = missionList.querySelector(".mission-actions");

  if (!actions) {
    xTaskButtonArea.innerHTML = "";
    return;
  }

  xTaskButtonArea.innerHTML = "";
  xTaskButtonArea.appendChild(actions);
}

function renderMissions() {
  if (!missionList) return;

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  if (!activeWallet) {
    clearXTaskButtonArea();

    missionList.innerHTML = `
      <div class="mission-card empty">
        <h3>Connect your wallet to load the latest official X mission.</h3>
      </div>
    `;

    return;
  }

  const latestTask = getLatestTask();

  if (!latestTask) {
    clearXTaskButtonArea();

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

  const noNewMissionForThisTask =
    noNewMissionLocked &&
    noNewMissionTaskId &&
    Number(noNewMissionTaskId) === Number(latestTask.id);

  const bindingConflict = getXBindingConflict(activeWallet);

  const verifyDisabled =
    isVerifying ||
    !currentXConnected ||
    noNewMissionForThisTask ||
    Boolean(bindingConflict);

  const openDisabled = currentXConnected;

  const openButtonText = currentXConnected
    ? claimed
      ? "Completed"
      : "X Authorized"
    : "Link X";

  const verifyButtonText = isVerifying
    ? "checking..."
    : noNewMissionForThisTask
      ? "No New Mission"
      : claimed
        ? "Check Mission"
        : claimable || verified
          ? "Claim Reward"
          : "Claim Reward";

  missionList.innerHTML = `
    <div class="mission-summary">
      <span>Latest mission only</span>
      <span>${
        currentXConnected
          ? `@${escapeHtml(currentXUsername || "connected")}`
          : "X not connected"
      }</span>
    </div>

    <div
      class="mission-card"
      data-task-id="${latestTask.id}"
      data-tweet-id="${tweetId}"
    >
      <div class="mission-head">
        <div>
          <h3>${escapeHtml(latestTask.title || "")}</h3>

          <p class="reward">
            Reward:
            ${escapeHtml(latestTask.reward_amount || "1")}
            drop
          </p>
        </div>
      </div>

      <p class="message x-task-message">
        Follow @${escapeHtml(OFFICIAL_X_USERNAME)},<br />
        like, repost,<br />
        and comment.<br />
        Claim Reward.
      </p>

      <a
        class="mission-link"
        href="${tweetUrl}"
        target="_blank"
        rel="noopener noreferrer"
      >
        ${tweetUrl}
      </a>

      <div class="mission-actions">
        <button
          class="btn full light open-task-btn"
          type="button"
          data-tweet-id="${tweetId}"
          ${openDisabled ? "disabled" : ""}
        >
          ${openButtonText}
        </button>

        <button
          class="btn full gold verify-task-btn"
          type="button"
          data-task-id="${latestTask.id}"
          ${verifyDisabled ? "disabled" : ""}
        >
          ${verifyButtonText}
        </button>
      </div>
    </div>
  `;

  moveMissionButtonsToButtonArea();

  const buttonRoot = xTaskButtonArea || missionList;

  const openButton = buttonRoot.querySelector(".open-task-btn");

  const verifyButton = buttonRoot.querySelector(".verify-task-btn");

  if (openButton) {
    openButton.addEventListener("click", () => {
      if (bindingConflict) {
        showCustomAlert(getXBindingConflictMessage(bindingConflict));

        return;
      }

      if (claimed) {
        showMessage("Latest mission already claimed.", "ok");

        return;
      }

      if (currentXConnected) {
        showMessage(
          "X already authorized. Complete the mission on X, then tap Claim Reward.",
          "ok",
        );

        return;
      }

      openTaskX(tweetId);
    });
  }

  if (verifyButton) {
    verifyButton.addEventListener("click", () => {
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

  const bindingConflict = getXBindingConflict(activeWallet);

  if (bindingConflict) {
    showCustomAlert(getXBindingConflictMessage(bindingConflict));

    return;
  }

  const latestTask = getLatestTask();

  if (
    latestTask &&
    tweetId &&
    String(tweetId) !== String(latestTask.tweet_id)
  ) {
    showMessage("Only the latest official post can be claimed.", "err");

    return;
  }

  const latestProgress = getLatestTaskProgress();

  if (latestProgress && latestProgress.claimed) {
    showMessage("Latest mission already claimed.", "ok");

    clearPendingXState();

    return;
  }

  localStorage.setItem("pending_official_x", "true");

  if (tweetId) {
    setCurrentTweetId(tweetId);
  }

  if (!isXConnected()) {
    localStorage.setItem("pending_x_wallet", activeWallet);

    showMessage("X authorization is required first. Redirecting to X...", "ok");

    setTimeout(() => {
      window.location.href = `/api/x/login?wallet=${encodeURIComponent(
        activeWallet,
      )}`;
    }, 300);

    return;
  }

  openTaskXDirect(tweetId);
}

function openTaskXDirect(tweetId) {
  const latestTask = getLatestTask();

  if (
    latestTask &&
    tweetId &&
    String(tweetId) !== String(latestTask.tweet_id)
  ) {
    setCurrentTweetId(tweetId);
  }

  showMessage(
    `Opening @${OFFICIAL_X_USERNAME}. Follow, like, repost, and comment on the latest post, then manually return here to claim.`,
    "ok",
  );

  const targetWebUrl = getXTargetUrl(tweetId);

  const targetAppUrl = getXTargetAppUrl(tweetId);

  try {
    navigator.clipboard.writeText(targetWebUrl).catch(() => {});
  } catch {}

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

  document.addEventListener("visibilitychange", onVisibilityChange, {
    once: true,
  });

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
    data && (data.message || data.error || data.detail || ""),
  ).toLowerCase();

  return (
    text.includes("already claimed") ||
    text.includes("latest official post already claimed") ||
    text.includes("no unclaimed official posts found") ||
    text.includes("already claimed on chain")
  );
}

function requiresXLink(data) {
  if (data && data.requiresXLink) {
    return true;
  }

  if (
    data &&
    ["X_NOT_LINKED", "X_TOKEN_MISSING", "X_TOKEN_EXPIRED"].includes(data.code)
  ) {
    return true;
  }

  const text = String(
    data && (data.message || data.error || data.detail || ""),
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

async function getClaimSignature(activeWallet, tweetId) {
  const response = await fetch("/api/signature", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      wallet: activeWallet,
      tweetId: String(tweetId),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!data.success) {
    const error = new Error(
      data.error || data.detail || "Failed to get claim signature",
    );

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

  await switchToEthereumMainnet();

  const web3Provider = new ethers.providers.Web3Provider(walletProvider, "any");

  const web3Signer = web3Provider.getSigner();

  const connectedAddress = await web3Signer.getAddress();

  if (connectedAddress.toLowerCase() !== activeWallet.toLowerCase()) {
    throw new Error("Connected wallet does not match verified wallet");
  }

  const contract = new ethers.Contract(
    signatureData.contract,
    TWITTER_TASK_CLAIM_ABI,
    web3Signer,
  );

  const alreadyClaimed = await contract.isClaimed(
    activeWallet,
    signatureData.tweetHash,
  );

  if (alreadyClaimed) {
    throw new Error("Already claimed on chain");
  }

  const claimFee = await contract.claimFee();

  showMessage(
    "Please confirm the on-chain claim transaction in your wallet.",
    "ok",
  );

  const tx = await contract.claim(
    signatureData.tweetHash,
    signatureData.deadline,
    signatureData.signature,
    {
      value: claimFee,
    },
  );

  showMessage("Transaction submitted. Waiting for confirmation...", "ok");

  await tx.wait();

  return tx.hash;
}

async function recordClaim(activeWallet, taskId, txHash) {
  const response = await fetch("/api/claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      wallet: activeWallet,
      taskId: Number(taskId),
      txHash,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!data.success) {
    const error = new Error(
      data.error || data.detail || "Failed to record claim",
    );

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

  const bindingConflict = getXBindingConflict(activeWallet);

  if (bindingConflict) {
    showCustomAlert(getXBindingConflictMessage(bindingConflict));

    return;
  }

  if (!currentXConnected) {
    showCustomAlert("Please tap Link X first.");

    return;
  }

  const latestTask = getLatestTask();

  if (!task || !task.id || !latestTask) {
    showMessage("Mission data missing. Please refresh and try again.", "err");

    return;
  }

  try {
    isVerifying = true;

    renderMissions();

    const taskId = Number(task.id);

    const tweetId = String(task.tweet_id);

    setCurrentTweetId(tweetId);

    showMessage("Checking latest X mission...");

    const verifyResponse = await fetch("/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        wallet: activeWallet,
        taskId,
      }),
    });

    const verifyData = await verifyResponse.json().catch(() => ({}));

    if (verifyData.tweetId || verifyData.latestTweetId) {
      setCurrentTweetId(verifyData.tweetId || verifyData.latestTweetId);
    }

    if (!verifyData.success) {
      if (requiresXLink(verifyData)) {
        clearXConnected(activeWallet);

        currentXConnected = false;

        currentXUsername = null;

        clearPendingXState();

        updateWalletUI();
        renderMissions();

        showCustomAlert(
          verifyData.message || "Please link your X account first.",
        );

        return;
      }

      if (verifyData.verificationError) {
        console.error("X verification request failed", {
          status: verifyResponse.status,
          retryable: Boolean(verifyData.retryable),
        });

        showMessage("");

        return;
      }

      if (shouldLockClaimButton(verifyData)) {
        showMessage(
          verifyData.message ||
            verifyData.error ||
            "Latest mission already claimed.",
          "ok",
        );

        clearPendingXState();

        await loadTasks(false);

        return;
      }

      const targetTweetId = String(
        verifyData.tweetId || verifyData.latestTweetId || tweetId,
      );

      const targetTaskId =
        verifyData.taskId || verifyData.latestTaskId || taskId;

      const latestProgressNow = getProgressForTask(task);

      if (
        latestProgressNow &&
        latestProgressNow.claimed &&
        Number(targetTaskId) === Number(taskId)
      ) {
        noNewMissionLocked = true;
        noNewMissionTaskId = Number(taskId);

        clearPendingXState();

        showMessage("No new mission yet. Please try again later.", "ok");

        renderMissions();

        return;
      }

      setCurrentTweetId(targetTweetId);

      showMessage(
        verifyData.message ||
          verifyData.error ||
          "Latest mission is not completed yet. Opening the exact X post...",
        "ok",
      );

      await loadTasks(false);

      setTimeout(() => {
        openTaskXDirect(targetTweetId);
      }, 800);

      return;
    }

    const verifiedTweetId = String(
      verifyData.tweetId || verifyData.latestTweetId || tweetId,
    );

    const verifiedTaskId =
      verifyData.taskId || verifyData.latestTaskId || taskId;

    const latestProgressNow = getProgressForTask(task);

    if (
      latestProgressNow &&
      latestProgressNow.claimed &&
      Number(verifiedTaskId) === Number(taskId)
    ) {
      noNewMissionLocked = true;
      noNewMissionTaskId = Number(taskId);

      clearPendingXState();

      showMessage("No new mission yet. Please try again later.", "ok");

      renderMissions();

      return;
    }

    showMessage("Mission verified. Getting claim signature...", "ok");

    const signatureData = await getClaimSignature(
      activeWallet,
      verifiedTweetId,
    );

    const txHash = await claimOnChain(signatureData, activeWallet);

    showMessage("On-chain claim confirmed. Recording claim...", "ok");

    await recordClaim(
      activeWallet,
      signatureData.taskId || verifiedTaskId,
      txHash,
    );

    clearPendingXState();

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
      clearPendingXState();

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

async function handleReturnFromX() {
  const pendingX = localStorage.getItem("pending_official_x");

  const activeWallet = userAddress || localStorage.getItem("wallet_address");

  const latestProgress = getLatestTaskProgress();

  if (latestProgress && latestProgress.claimed) {
    clearPendingXState();
    return;
  }

  if (!pendingX || !activeWallet || isRefreshingAfterX) return;

  try {
    isRefreshingAfterX = true;

    await loadTasks(false);

    const walletAfterRefresh = normalizeWallet(
      userAddress || localStorage.getItem("wallet_address") || "",
    );

    if (walletAfterRefresh !== normalizeWallet(activeWallet)) return;

    if (currentXConnected) {
      showMessage("");
    }
  } finally {
    isRefreshingAfterX = false;
  }
}

function handleUrlStatus() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("x_connected") === "1") {
    const walletFromUrl = normalizeWallet(params.get("wallet"));

    const xUsernameFromUrl = params.get("x_username");

    showMessage("");

    if (isValidWalletAddress(walletFromUrl)) {
      pendingXCallback = {
        wallet: walletFromUrl,
        xUsername: xUsernameFromUrl || null,
      };

      localStorage.setItem("pending_x_wallet", walletFromUrl);
      setXConnected(walletFromUrl);
    }

    if (xUsernameFromUrl) {
      localStorage.setItem("x_username", xUsernameFromUrl);
    }

    const cleanUrl =
      window.location.origin + window.location.pathname + window.location.hash;

    window.history.replaceState({}, document.title, cleanUrl);
  }

  const xError = params.get("x_error");

  if (xError) {
    if (xError === "already_bound") {
      const attemptedWallet =
        params.get("attempted_wallet") ||
        userAddress ||
        localStorage.getItem("wallet_address") ||
        localStorage.getItem("pending_x_wallet");

      const boundWalletHint =
        params.get("bound_wallet") || "the original wallet";

      if (attemptedWallet) {
        setXBindingConflict(attemptedWallet, boundWalletHint);
        clearXConnected(attemptedWallet);
      }

      currentXConnected = false;
      currentXUsername = null;
      clearPendingXState();
      updateWalletUI();
      renderMissions();

      showCustomAlert(
        getXBindingConflictMessage({ boundWalletHint }),
      );
    }

    const errorMap = {
      missing_oauth_params:
        "Missing X authorization data. Please tap Link X and try again.",

      oauth_state_not_found:
        "X authorization expired or opened in another browser. Please tap Link X and try again.",

      oauth_expired: "X authorization expired. Please tap Link X and try again.",

      missing_wallet:
        "Missing wallet address. Please connect wallet and try again.",
    };

    if (xError !== "already_bound") {
      showCustomAlert(
        errorMap[xError] || `X connection failed: ${xError}`,
      );
    }

    const cleanUrl =
      window.location.origin + window.location.pathname + window.location.hash;

    window.history.replaceState({}, document.title, cleanUrl);
  }
}

(function () {
  const bgMusic = document.getElementById("bgMusic");

  const musicToggleBtn = document.getElementById("musicToggleBtn");

  if (!bgMusic || !musicToggleBtn) {
    return;
  }

  bgMusic.volume = 0.35;

  let bgMusicStarted = false;
  let bgMusicStarting = false;

  function updateMusicButton() {
    if (bgMusic.paused) {
      musicToggleBtn.classList.remove("is-playing");

      musicToggleBtn.setAttribute("aria-label", "Play music");
    } else {
      musicToggleBtn.classList.add("is-playing");

      musicToggleBtn.setAttribute("aria-label", "Pause music");
    }
  }

  async function startBgMusicOnce(event) {
    if (event && event.target && event.target.closest("#musicToggleBtn")) {
      return;
    }

    if (bgMusicStarted || bgMusicStarting) {
      return;
    }

    bgMusicStarting = true;

    try {
      await bgMusic.play();
      bgMusicStarted = true;
    } catch (error) {
      console.log("Background music blocked:", error);
    } finally {
      bgMusicStarting = false;
    }

    updateMusicButton();
  }

  async function toggleMusic(event) {
    event.preventDefault();
    event.stopPropagation();

    try {
      if (bgMusic.paused) {
        bgMusicStarting = true;
        await bgMusic.play();
        bgMusicStarted = true;
      } else {
        bgMusic.pause();
      }
    } catch (error) {
      console.log("Music play blocked:", error);
    } finally {
      bgMusicStarting = false;
    }

    updateMusicButton();
  }

  musicToggleBtn.addEventListener("click", toggleMusic);

  document.addEventListener("pointerdown", startBgMusicOnce, {
    capture: true,
    passive: true,
  });

  document.addEventListener("click", startBgMusicOnce, {
    capture: true,
  });

  document.addEventListener("touchstart", startBgMusicOnce, {
    capture: true,
    passive: true,
  });

  document.addEventListener("wheel", startBgMusicOnce, {
    capture: true,
    passive: true,
  });

  bgMusic.addEventListener("play", updateMusicButton);

  bgMusic.addEventListener("pause", updateMusicButton);

  bgMusic.addEventListener("ended", updateMusicButton);

  updateMusicButton();
})();

bindComingSoonLinks();

document.addEventListener("keydown", (event) => {
  const alertBox = document.getElementById("customAlert");

  if (
    event.key === "Escape" &&
    alertBox &&
    !alertBox.classList.contains("hidden")
  ) {
    closeCustomAlert();
  }
});

if (connectBtn) {
  connectBtn.addEventListener("click", connectWallet);
}

if (copyRefBtn) {
  copyRefBtn.addEventListener("click", copyReferralLink);
}

if (copyRefBtnMobile) {
  copyRefBtnMobile.addEventListener("click", copyReferralLink);
}

if (claimReferralBtn) {
  claimReferralBtn.addEventListener("click", claimReferralAirdrop);
}

if (xProfileAppBtn) {
  xProfileAppBtn.addEventListener("click", openOfficialXProfileInApp);
}

if (communityXAppBtn) {
  communityXAppBtn.addEventListener("click", openOfficialXProfileInApp);
}

if (copyContractBtn) {
  copyContractBtn.addEventListener("click", copyContractAddress);
}

if (copyHeroContractBtn) {
  copyHeroContractBtn.addEventListener("click", copyHeroContractAddress);
}

window.addEventListener("focus", handleReturnFromX);
window.addEventListener("pageshow", handleReturnFromX);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    handleReturnFromX();
  }
});

window.addEventListener("load", async () => {
  if (heroContractAddressText) {
    heroContractAddressText.textContent = DISPLAY_HERO_CONTRACT_ADDRESS;
  }

  if (contractAddressInput) {
    contractAddressInput.value = DISPLAY_TOKEN_CONTRACT_ADDRESS;
  }

  handleUrlStatus();

  const tasksLoadedForWallet = await autoConnectWallet();

  if (!tasksLoadedForWallet) {
    await loadTasks(true);
  }

  pendingXCallback = null;

  listenWalletChange();
});

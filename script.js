// Replace this with your BSC airdrop contract address after deployment.
const AIRDROP_CONTRACT = "0x81f9047279F8DCcB1BCbC51c176fA12b232e6F21";

const BSC_CHAIN_ID_HEX = "0x38";
const BSC_CHAIN_ID_DEC = 56;

const BSC_RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc.publicnode.com",
  "https://rpc.ankr.com/bsc"
];

const ABI = [
  "function claim(address referrer) external payable",
  "function claimFee() external view returns (uint256)",
  "function claimed(address user) external view returns (bool)",
  "function claimEnabled() external view returns (bool)"
];

let provider = null;
let readProvider = null;
let signer = null;
let userAddress = null;
let contract = null;
let readContract = null;
let contractLoaded = false;
let isClaiming = false;
let isLoading = false;

const connectBtn = document.getElementById("connectBtn");
const claimBtn = document.getElementById("claimBtn");
const referrerInput = document.getElementById("referrerInput");
const refLink = document.getElementById("refLink");
const copyBtn = document.getElementById("copyBtn");
const message = document.getElementById("message");
const walletText = document.getElementById("walletText");
const feeText = document.getElementById("feeText");
const refBox = document.getElementById("refBox");
const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");

function showMessage(text) {
  if (message) message.innerText = text || "";
}

function getReadableError(error) {
  if (!error) return "Unknown error";

  if (error.code === 4001) return "User rejected the request.";
  if (error.code === -32002) return "Wallet request already pending. Please open your wallet.";
  if (error.data && error.data.message) return error.data.message;
  if (error.error && error.error.message) return error.error.message;
  if (error.reason) return error.reason;
  if (error.message) return error.message;

  return String(error);
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";
}

function setClaimButton(text, disabled) {
  if (!claimBtn) return;
  claimBtn.innerText = text;
  claimBtn.disabled = disabled;
}

function getWalletProvider() {
  if (window.okxwallet && window.okxwallet.ethereum) return window.okxwallet.ethereum;
  if (window.ethereum) return window.ethereum;
  return null;
}

function createFastReadProvider() {
  const providers = BSC_RPC_URLS.map((url, index) => ({
    provider: new ethers.providers.JsonRpcProvider(url, {
      name: "bnb-smart-chain",
      chainId: BSC_CHAIN_ID_DEC
    }),
    priority: index + 1,
    weight: 1,
    stallTimeout: 1500
  }));

  return new ethers.providers.FallbackProvider(providers, 1);
}

async function switchToBSC() {
  const walletProvider = getWalletProvider();
  if (!walletProvider) throw new Error("No wallet provider found");

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

function getReferrerFromUrl() {
  if (!referrerInput) return;

  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");

  if (ref && ethers.utils.isAddress(ref)) {
    referrerInput.value = ref;
  }
}

function updateWalletUI() {
  if (!userAddress) return;

  if (connectBtn) connectBtn.innerText = shortAddress(userAddress);
  if (walletText) walletText.innerText = shortAddress(userAddress);

  if (refLink) {
    const currentUrl = window.location.origin + window.location.pathname;
    refLink.value = `${currentUrl}?ref=${userAddress}`;
  }

  if (refBox) {
    refBox.classList.remove("hidden");
  }
}

function resetWalletUI() {
  userAddress = null;
  provider = null;
  signer = null;
  contract = null;
  readContract = null;
  contractLoaded = false;
  isClaiming = false;
  isLoading = false;

  localStorage.removeItem("wallet_connected");
  localStorage.removeItem("wallet_address");

  if (connectBtn) connectBtn.innerText = "connect wallet";
  if (walletText) walletText.innerText = "Not connected";
  if (refLink) refLink.value = "";
  if (refBox) refBox.classList.add("hidden");
  if (feeText) feeText.innerText = "--";

  setClaimButton("claim $SHIT", true);
}

async function setupWalletAfterConnected() {
  const walletProvider = getWalletProvider();
  if (!walletProvider) throw new Error("No wallet provider found");

  provider = new ethers.providers.Web3Provider(walletProvider, "any");
  signer = provider.getSigner();
  userAddress = await signer.getAddress();

  contract = new ethers.Contract(AIRDROP_CONTRACT, ABI, signer);

  // Main read: wallet provider
  readContract = new ethers.Contract(AIRDROP_CONTRACT, ABI, provider);

  // Backup read provider
  if (!readProvider) {
    readProvider = createFastReadProvider();
  }

  localStorage.setItem("wallet_connected", "true");
  localStorage.setItem("wallet_address", userAddress);

  updateWalletUI();
  await loadContractData();
}

async function readContractDataWithFallback() {
  const walletReadContract = readContract || contract;

  try {
    return await Promise.all([
      walletReadContract.claimFee(),
      walletReadContract.claimEnabled(),
      walletReadContract.claimed(userAddress)
    ]);
  } catch (walletReadError) {
    console.warn("Wallet provider read failed, trying fallback RPC:", walletReadError);

    if (!readProvider) {
      readProvider = createFastReadProvider();
    }

    const fallbackContract = new ethers.Contract(AIRDROP_CONTRACT, ABI, readProvider);

    return await Promise.all([
      fallbackContract.claimFee(),
      fallbackContract.claimEnabled(),
      fallbackContract.claimed(userAddress)
    ]);
  }
}

async function checkContractCode() {
  try {
    const code = await provider.getCode(AIRDROP_CONTRACT);
    if (code && code !== "0x") return true;
  } catch (error) {
    console.warn("Wallet provider getCode failed, trying fallback RPC:", error);
  }

  if (!readProvider) {
    readProvider = createFastReadProvider();
  }

  const fallbackCode = await readProvider.getCode(AIRDROP_CONTRACT);
  return fallbackCode && fallbackCode !== "0x";
}

async function loadContractData() {
  if (isLoading) return;
  isLoading = true;
  contractLoaded = false;

  if (!userAddress) {
    if (walletText) walletText.innerText = "Not connected";
    setClaimButton("claim $SHIT", true);
    isLoading = false;
    return;
  }

  try {
    setClaimButton("loading...", true);

    if (!ethers.utils.isAddress(AIRDROP_CONTRACT)) {
      throw new Error("Invalid airdrop contract address.");
    }

    const network = await provider.getNetwork();

    if (network.chainId !== BSC_CHAIN_ID_DEC) {
      await switchToBSC();
      await setupWalletAfterConnected();
      isLoading = false;
      return;
    }

    const hasCode = await checkContractCode();

    if (!hasCode) {
      throw new Error("No contract found on BNB Smart Chain at this address.");
    }

    const [fee, enabled, hasClaimed] = await readContractDataWithFallback();

    contractLoaded = true;

    if (feeText) {
      feeText.innerText = ethers.utils.formatEther(fee) + " BNB";
    }

    if (!enabled) {
      setClaimButton("claim closed", true);
      showMessage("Airdrop claim is currently closed.");
    } else if (hasClaimed) {
      setClaimButton("claimed", true);
      showMessage("This wallet has already claimed.");
    } else {
      setClaimButton("claim $SHIT", false);
      showMessage("Wallet connected successfully on BNB Smart Chain.");
    }
  } catch (error) {
    console.error(error);
    const detail = getReadableError(error);

    setClaimButton("retry load", false);
    showMessage("Load failed: " + detail);
  } finally {
    isLoading = false;
  }
}

async function connectWallet() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    showMessage("Please open this page in MetaMask, OKX Wallet, TokenPocket, Trust Wallet or another Web3 wallet browser.");
    return;
  }

  try {
    if (connectBtn) connectBtn.disabled = true;
    showMessage("Connecting wallet...");

    await switchToBSC();

    provider = new ethers.providers.Web3Provider(walletProvider, "any");
    await provider.send("eth_requestAccounts", []);

    await setupWalletAfterConnected();
  } catch (error) {
    console.error(error);
    showMessage("Wallet connection failed: " + getReadableError(error));
  } finally {
    if (connectBtn) connectBtn.disabled = false;
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
        showMessage("Wallet account changed.");
      } catch (error) {
        console.error(error);
        showMessage("Wallet account changed, please reconnect.");
      }
    } else {
      resetWalletUI();
      showMessage("Wallet disconnected.");
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

async function claimAirdrop() {
  if (isClaiming) return;

  if (!contract || !userAddress) {
    showMessage("Please connect wallet first.");
    return;
  }

  if (!contractLoaded) {
    await loadContractData();
    return;
  }

  try {
    isClaiming = true;
    setClaimButton("checking...", true);

    const network = await provider.getNetwork();

    if (network.chainId !== BSC_CHAIN_ID_DEC) {
      await switchToBSC();
      await setupWalletAfterConnected();
      showMessage("Switched to BNB Smart Chain. Please claim again.");
      return;
    }

    let referrer = ethers.constants.AddressZero;

    if (referrerInput) {
      const inputReferrer = referrerInput.value.trim();

      if (inputReferrer && ethers.utils.isAddress(inputReferrer)) {
        referrer = inputReferrer;
      }
    }

    if (referrer.toLowerCase() === userAddress.toLowerCase()) {
      showMessage("You cannot use your own address as referrer.");
      setClaimButton("claim $SHIT", false);
      return;
    }

    const hasClaimed = await contract.claimed(userAddress);

    if (hasClaimed) {
      setClaimButton("claimed", true);
      showMessage("This wallet has already claimed.");
      return;
    }

    const enabled = await contract.claimEnabled();

    if (!enabled) {
      setClaimButton("claim closed", true);
      showMessage("Airdrop claim is currently closed.");
      return;
    }

    const fee = await contract.claimFee();

    setClaimButton("claiming...", true);

    const tx = await contract.claim(referrer, {
      value: fee
    });

    showMessage("Transaction submitted: " + tx.hash);

    await tx.wait();

    contractLoaded = false;
    setClaimButton("claimed", true);
    showMessage("Claim successful!");
  } catch (error) {
    console.error(error);

    const detail = getReadableError(error);

    showMessage("Claim failed: " + detail);

    if (contractLoaded) {
      setClaimButton("claim $SHIT", false);
    } else {
      setClaimButton("retry load", false);
    }
  } finally {
    isClaiming = false;
  }
}

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    if (!refLink || !refLink.value) {
      showMessage("Please connect wallet first.");
      return;
    }

    try {
      await navigator.clipboard.writeText(refLink.value);
      showMessage("Referral link copied.");
    } catch (error) {
      try {
        refLink.select();
        document.execCommand("copy");
        showMessage("Referral link copied.");
      } catch (copyError) {
        showMessage("Copy failed. Please copy the link manually.");
      }
    }
  });
}

if (connectBtn) {
  connectBtn.addEventListener("click", connectWallet);
}

if (claimBtn) {
  claimBtn.addEventListener("click", claimAirdrop);
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

window.addEventListener("load", () => {
  getReferrerFromUrl();
  autoConnectWallet();
  listenWalletChange();
});
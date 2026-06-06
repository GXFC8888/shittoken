// Replace this with your BSC airdrop contract address after deployment.
const AIRDROP_CONTRACT = "0x45B5004bbeF9575ebEC3C84b493Ae0D4daF53403";

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

let provider;
let readProvider;
let signer;
let userAddress;
let contract;
let readContract;
let contractLoaded = false;

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

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";
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
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
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
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  if (ref && ethers.utils.isAddress(ref)) referrerInput.value = ref;
}

function updateWalletUI() {
  if (!userAddress) return;
  connectBtn.innerText = shortAddress(userAddress);
  walletText.innerText = shortAddress(userAddress);
  const currentUrl = window.location.origin + window.location.pathname;
  refLink.value = `${currentUrl}?ref=${userAddress}`;
  refBox.classList.remove("hidden");
}

async function setupWalletAfterConnected() {
  const walletProvider = getWalletProvider();

  provider = new ethers.providers.Web3Provider(walletProvider);
  readProvider = createFastReadProvider();
  signer = provider.getSigner();
  userAddress = await signer.getAddress();

  contract = new ethers.Contract(AIRDROP_CONTRACT, ABI, signer);
  readContract = new ethers.Contract(AIRDROP_CONTRACT, ABI, readProvider);

  localStorage.setItem("wallet_connected", "true");
  localStorage.setItem("wallet_address", userAddress);

  updateWalletUI();
  await loadContractData();
}

async function loadContractData() {
  contractLoaded = false;

  if (!userAddress) {
    walletText.innerText = "Not connected";
    claimBtn.disabled = true;
    claimBtn.innerText = "claim $SHIT";
    return;
  }

  try {
    if (!ethers.utils.isAddress(AIRDROP_CONTRACT)) {
      throw new Error("Invalid airdrop contract address");
    }

    const fastContract = readContract || contract;
    const [fee, enabled, hasClaimed] = await Promise.all([
      fastContract.claimFee(),
      fastContract.claimEnabled(),
      fastContract.claimed(userAddress)
    ]);

    contractLoaded = true;
    if (feeText) feeText.innerText = ethers.utils.formatEther(fee) + " BNB";

    if (!enabled) {
      claimBtn.disabled = true;
      claimBtn.innerText = "claim closed";
      showMessage("Airdrop claim is currently closed.");
    } else if (hasClaimed) {
      claimBtn.disabled = true;
      claimBtn.innerText = "claimed";
      showMessage("This wallet has already claimed.");
    } else {
      claimBtn.disabled = false;
      claimBtn.innerText = "claim $SHIT";
      showMessage("Wallet connected successfully on BNB Smart Chain.");
    }
  } catch (error) {
    console.error(error);
    claimBtn.disabled = false;
    claimBtn.innerText = "retry load";
    showMessage("Load failed. Usually this means the airdrop contract address is not a BSC contract, the address is wrong, or the contract ABI does not match.");
  }
}

async function connectWallet() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    showMessage("Please open this page in MetaMask, OKX Wallet, TokenPocket, Trust Wallet or another Web3 wallet browser.");
    return;
  }

  try {
    await switchToBSC();
    provider = new ethers.providers.Web3Provider(walletProvider);
    await provider.send("eth_requestAccounts", []);
    await setupWalletAfterConnected();
  } catch (error) {
    console.error(error);
    showMessage("Wallet connection failed. Please switch to BNB Smart Chain.");
  }
}

async function autoConnectWallet() {
  const walletProvider = getWalletProvider();
  if (!walletProvider) return;
  if (localStorage.getItem("wallet_connected") !== "true") return;

  try {
    const accounts = await walletProvider.request({ method: "eth_accounts" });
    if (!accounts || accounts.length === 0) {
      localStorage.removeItem("wallet_connected");
      localStorage.removeItem("wallet_address");
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
      }
    } else {
      userAddress = null;
      contract = null;
      readContract = null;
      contractLoaded = false;
      localStorage.removeItem("wallet_connected");
      localStorage.removeItem("wallet_address");
      connectBtn.innerText = "connect wallet";
      walletText.innerText = "Not connected";
      refLink.value = "";
      refBox.classList.add("hidden");
      claimBtn.disabled = true;
      claimBtn.innerText = "claim $SHIT";
      showMessage("Wallet disconnected.");
    }
  });

  walletProvider.on("chainChanged", () => window.location.reload());
}

async function claimAirdrop() {
  if (!contract || !userAddress) {
    showMessage("Please connect wallet first.");
    return;
  }

  if (!contractLoaded) {
    await loadContractData();
    return;
  }

  try {
    const network = await provider.getNetwork();
    if (network.chainId !== BSC_CHAIN_ID_DEC) {
      await switchToBSC();
      showMessage("Please switch to BNB Smart Chain and try again.");
      return;
    }

    let referrer = referrerInput.value.trim();
    if (!referrer || !ethers.utils.isAddress(referrer)) referrer = ethers.constants.AddressZero;

    if (referrer.toLowerCase() === userAddress.toLowerCase()) {
      showMessage("You cannot use your own address as referrer.");
      return;
    }

    const fee = await contract.claimFee();
    claimBtn.disabled = true;
    claimBtn.innerText = "claiming...";

    const tx = await contract.claim(referrer, { value: fee });
    showMessage("Transaction submitted: " + tx.hash);
    await tx.wait();

    claimBtn.innerText = "claimed";
    claimBtn.disabled = true;
    showMessage("Claim successful!");
  } catch (error) {
    console.error(error);
    let errorMsg = "Claim failed.";
    if (error && error.data && error.data.message) errorMsg = error.data.message;
    else if (error && error.reason) errorMsg = error.reason;
    else if (error && error.message) errorMsg = error.message;
    showMessage(errorMsg);
    claimBtn.disabled = false;
    claimBtn.innerText = "claim $SHIT";
  }
}

copyBtn.addEventListener("click", async () => {
  if (!refLink.value) {
    showMessage("Please connect wallet first.");
    return;
  }

  try {
    await navigator.clipboard.writeText(refLink.value);
    showMessage("Referral link copied.");
  } catch (error) {
    refLink.select();
    document.execCommand("copy");
    showMessage("Referral link copied.");
  }
});

connectBtn.addEventListener("click", connectWallet);
claimBtn.addEventListener("click", claimAirdrop);

if (menuBtn && navMenu) {
  menuBtn.addEventListener("click", () => navMenu.classList.toggle("show"));
  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => navMenu.classList.remove("show"));
  });
}

window.addEventListener("load", () => {
  getReferrerFromUrl();
  autoConnectWallet();
  listenWalletChange();
});

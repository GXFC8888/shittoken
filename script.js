const AIRDROP_CONTRACT = "0x30120Ed9B0BefCF99729ec493A6E14797e113944";

const BSC_CHAIN_ID = "0x38";

const ABI = [
  "function claim(address referrer) external payable",
  "function claimFee() external view returns (uint256)",
  "function claimed(address user) external view returns (bool)",
  "function claimEnabled() external view returns (bool)"
];

let provider;
let signer;
let userAddress;
let contract;

const connectBtn = document.getElementById("connectBtn");
const claimBtn = document.getElementById("claimBtn");
const referrerInput = document.getElementById("referrerInput");
const refLink = document.getElementById("refLink");
const copyBtn = document.getElementById("copyBtn");
const message = document.getElementById("message");
const claimFeeText = document.getElementById("claimFeeText");
const claimStatus = document.getElementById("claimStatus");

function showMessage(text) {
  message.innerText = text;
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
      params: [{ chainId: BSC_CHAIN_ID }]
    });
  } catch (error) {
    if (error.code === 4902) {
      await walletProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BSC_CHAIN_ID,
            chainName: "BNB Smart Chain",
            nativeCurrency: {
              name: "BNB",
              symbol: "BNB",
              decimals: 18
            },
            rpcUrls: ["https://bsc-dataseed.binance.org/"],
            blockExplorerUrls: ["https://bscscan.com"]
          }
        ]
      });
    } else {
      throw error;
    }
  }
}

function getReferrerFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");

  if (ref && ethers.utils.isAddress(ref)) {
    referrerInput.value = ref;
  }
}

function updateWalletUI() {
  connectBtn.innerText = userAddress.slice(0, 6) + "..." + userAddress.slice(-4);

  const currentUrl = window.location.origin + window.location.pathname;
  refLink.value = `${currentUrl}?ref=${userAddress}`;
}

async function setupWalletAfterConnected() {
  const walletProvider = getWalletProvider();

  provider = new ethers.providers.Web3Provider(walletProvider);
  signer = provider.getSigner();
  userAddress = await signer.getAddress();
  contract = new ethers.Contract(AIRDROP_CONTRACT, ABI, signer);

  localStorage.setItem("wallet_connected", "true");
  localStorage.setItem("wallet_address", userAddress);

  updateWalletUI();
  await loadContractData();
}

async function loadContractData() {
  try {
    const fee = await contract.claimFee();

    // 手续费仍然正常读取和支付，只是不在前端页面展示。
    if (claimFeeText) {
      claimFeeText.innerText = `${ethers.utils.formatEther(fee)} BNB`;
    }

    const enabled = await contract.claimEnabled();
    const hasClaimed = await contract.claimed(userAddress);

    if (!enabled) {
      claimStatus.innerText = "Claim Closed";
      claimBtn.disabled = true;
    } else if (hasClaimed) {
      claimStatus.innerText = "Already Claimed";
      claimBtn.disabled = true;
    } else {
      claimStatus.innerText = "Available";
      claimBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    if (claimFeeText) {
      claimFeeText.innerText = "Load Failed";
    }
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

    showMessage("Wallet connected successfully.");
  } catch (error) {
    console.error(error);
    showMessage("Wallet connection failed.");
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
      localStorage.removeItem("wallet_connected");
      localStorage.removeItem("wallet_address");
      return;
    }

    await switchToBSC();
    await setupWalletAfterConnected();

    showMessage("Wallet connected successfully.");
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
      localStorage.removeItem("wallet_connected");
      localStorage.removeItem("wallet_address");
      connectBtn.innerText = "Connect Wallet";
      refLink.value = "";
      claimStatus.innerText = "Not Connected";
      claimBtn.disabled = true;
      showMessage("Wallet disconnected.");
    }
  });

  walletProvider.on("chainChanged", () => {
    window.location.reload();
  });
}

async function claimAirdrop() {
  if (!contract || !userAddress) {
    showMessage("Please connect wallet first.");
    return;
  }

  try {
    let referrer = referrerInput.value.trim();

    if (!referrer || !ethers.utils.isAddress(referrer)) {
      referrer = ethers.constants.AddressZero;
    }

    if (referrer.toLowerCase() === userAddress.toLowerCase()) {
      showMessage("You cannot use your own address as referrer.");
      return;
    }

    // 正常从合约读取手续费，并在领取时支付。
    const fee = await contract.claimFee();

    claimBtn.disabled = true;
    claimBtn.innerText = "Claiming...";

    const tx = await contract.claim(referrer, {
      value: fee
    });

    showMessage("Transaction submitted: " + tx.hash);

    await tx.wait();

    showMessage("Claim successful!");

    claimBtn.innerText = "Claimed";
    claimStatus.innerText = "Already Claimed";
  } catch (error) {
    console.error(error);

    let errorMsg = "Claim failed.";

    if (error && error.data && error.data.message) {
      errorMsg = error.data.message;
    } else if (error && error.message) {
      errorMsg = error.message;
    }

    showMessage(errorMsg);
    claimBtn.disabled = false;
    claimBtn.innerText = "Claim Airdrop";
  }
}

copyBtn.addEventListener("click", async () => {
  if (!refLink.value) {
    showMessage("Please connect wallet first.");
    return;
  }

  await navigator.clipboard.writeText(refLink.value);
  showMessage("Referral link copied.");
});

connectBtn.addEventListener("click", connectWallet);
claimBtn.addEventListener("click", claimAirdrop);

window.addEventListener("load", () => {
  getReferrerFromUrl();
  autoConnectWallet();
  listenWalletChange();
});

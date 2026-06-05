const AIRDROP_CONTRACT = "0xFc3e9CdDcBCb87612F9A2F38CC79b6785A4739fB";

const ETH_CHAIN_ID = "0x1";

const ETH_RPC_URLS = [
  "https://ethereum.publicnode.com",
  "https://rpc.ankr.com/eth",
  "https://eth.llamarpc.com",
  "https://cloudflare-eth.com"
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

function createFastReadProvider() {
  const providers = ETH_RPC_URLS.map((url, index) => {
    return {
      provider: new ethers.providers.JsonRpcProvider(url, {
        name: "homestead",
        chainId: 1
      }),
      priority: index + 1,
      weight: 1,
      stallTimeout: 1200
    };
  });

  return new ethers.providers.FallbackProvider(providers, 1);
}

async function switchToETH() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    throw new Error("No wallet provider found");
  }

  try {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ETH_CHAIN_ID }]
    });
  } catch (error) {
    if (error.code === 4902) {
      await walletProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ETH_CHAIN_ID,
            chainName: "Ethereum Mainnet",
            nativeCurrency: {
              name: "Ether",
              symbol: "ETH",
              decimals: 18
            },
            rpcUrls: ETH_RPC_URLS,
            blockExplorerUrls: ["https://etherscan.io"]
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
  if (!userAddress) return;

  connectBtn.innerText = userAddress.slice(0, 6) + "..." + userAddress.slice(-4);

  const currentUrl = window.location.origin + window.location.pathname;
  refLink.value = `${currentUrl}?ref=${userAddress}`;
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
  if (!userAddress) {
    claimStatus.innerText = "Not Connected";
    claimBtn.disabled = true;

    if (claimFeeText) {
      claimFeeText.innerText = "";
    }

    return;
  }

  try {
    const fastContract = readContract || contract;

    const [fee, enabled, hasClaimed] = await Promise.all([
      fastContract.claimFee(),
      fastContract.claimEnabled(),
      fastContract.claimed(userAddress)
    ]);

    if (claimFeeText) {
      claimFeeText.innerText = "";
    }

    if (!enabled) {
      claimStatus.innerText = "Claim Closed";
      claimBtn.disabled = true;
      claimBtn.innerText = "Claim Airdrop";
    } else if (hasClaimed) {
      claimStatus.innerText = "Already Claimed";
      claimBtn.disabled = true;
      claimBtn.innerText = "Claimed";
    } else {
      claimStatus.innerText = "Available";
      claimBtn.disabled = false;
      claimBtn.innerText = "Claim Airdrop";
    }
  } catch (error) {
    console.error(error);

    if (claimFeeText) {
      claimFeeText.innerText = "";
    }

    claimStatus.innerText = "Load Failed";
    claimBtn.disabled = true;
    claimBtn.innerText = "Claim Airdrop";
  }
}

async function connectWallet() {
  const walletProvider = getWalletProvider();

  if (!walletProvider) {
    showMessage("Please open this page in MetaMask, OKX Wallet, TokenPocket, Trust Wallet or another Web3 wallet browser.");
    return;
  }

  try {
    await switchToETH();

    provider = new ethers.providers.Web3Provider(walletProvider);
    await provider.send("eth_requestAccounts", []);

    await setupWalletAfterConnected();

    showMessage("Wallet connected successfully.");
  } catch (error) {
    console.error(error);
    showMessage("Wallet connection failed. Please switch to Ethereum Mainnet.");
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

    await switchToETH();
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
      readContract = null;

      localStorage.removeItem("wallet_connected");
      localStorage.removeItem("wallet_address");

      connectBtn.innerText = "Connect Wallet";
      refLink.value = "";
      claimStatus.innerText = "Not Connected";
      claimBtn.disabled = true;
      claimBtn.innerText = "Claim Airdrop";

      if (claimFeeText) {
        claimFeeText.innerText = "";
      }

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
    const network = await provider.getNetwork();

    if (network.chainId !== 1) {
      await switchToETH();
      showMessage("Please switch to Ethereum Mainnet and try again.");
      return;
    }

    let referrer = referrerInput.value.trim();

    if (!referrer || !ethers.utils.isAddress(referrer)) {
      referrer = ethers.constants.AddressZero;
    }

    if (referrer.toLowerCase() === userAddress.toLowerCase()) {
      showMessage("You cannot use your own address as referrer.");
      return;
    }

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
    claimBtn.disabled = true;
    claimStatus.innerText = "Already Claimed";
  } catch (error) {
    console.error(error);

    let errorMsg = "Claim failed.";

    if (error && error.data && error.data.message) {
      errorMsg = error.data.message;
    } else if (error && error.reason) {
      errorMsg = error.reason;
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

  try {
    await navigator.clipboard.writeText(refLink.value);
    showMessage("Referral link copied.");
  } catch (error) {
    try {
      refLink.select();
      document.execCommand("copy");
      showMessage("Referral link copied.");
    } catch (copyError) {
      console.error(copyError);
      showMessage("Copy failed. Please copy the referral link manually.");
    }
  }
});

connectBtn.addEventListener("click", connectWallet);
claimBtn.addEventListener("click", claimAirdrop);

window.addEventListener("load", () => {
  getReferrerFromUrl();
  autoConnectWallet();
  listenWalletChange();
});
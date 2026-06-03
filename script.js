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

async function switchToBSC() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID }]
    });
  } catch (error) {
    if (error.code === 4902) {
      await window.ethereum.request({
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

async function loadContractData() {
  try {
    const fee = await contract.claimFee();
    claimFeeText.innerText = `${ethers.utils.formatEther(fee)} BNB`;

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
    claimFeeText.innerText = "Load Failed";
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    showMessage("Please install MetaMask or OKX Wallet first.");
    return;
  }

  try {
    await switchToBSC();

    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    contract = new ethers.Contract(AIRDROP_CONTRACT, ABI, signer);

    connectBtn.innerText =
      userAddress.slice(0, 6) + "..." + userAddress.slice(-4);

    const currentUrl = window.location.origin + window.location.pathname;
    refLink.value = `${currentUrl}?ref=${userAddress}`;

    showMessage("Wallet connected successfully.");

    await loadContractData();
  } catch (error) {
    console.error(error);
    showMessage("Wallet connection failed.");
  }
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

getReferrerFromUrl();

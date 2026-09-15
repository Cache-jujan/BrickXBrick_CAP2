require("dotenv").config();
const { ethers } = require("ethers");

async function main(){
  const provider = new ethers.JsonRpcProvider(process.env.GETH_RPC_URL);
  const accounts = await provider.send("eth_accounts", []);
  const devAccount = accounts[0];
  const balanceWei = await provider.getBalance(devAccount);

  console.log("Connected to geth --dev node at", process.env.GETH_RPC_URL);
  console.log("Pre-funded dev account:", devAccount);
  console.log("Balance:", ethers.formatEther(balanceWei), "ETH");
}

main().catch((err) => {
  console.error("connect.js failed:", err.message);
  process.exit(1);
});



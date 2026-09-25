require("dotenv").config();
const { Web3 } = require("web3");

async function main() {
  const web3 = new Web3(process.env.GETH_RPC_URL);
  const [devAccount] = await web3.eth.getAccounts();
  const balanceWei = await web3.eth.getBalance(devAccount);

  console.log("Connected to geth node at", process.env.GETH_RPC_URL);
  console.log("Account:", devAccount);
  console.log("Balance:", web3.utils.fromWei(balanceWei, "ether"), "ETH");
}

main().catch((err) => {
  console.error("connect.js failed:", err.message);
  process.exit(1);
});
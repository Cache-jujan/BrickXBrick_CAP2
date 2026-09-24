const fs = require("fs");
const { config } = require("process");

// Paste the 3 addresses geth printed in Step 7, in any order — this script sorts them.
const signers = [
  "0xfCA42061f09eC014A93AF3Bb56188F522142604C",
  "0x4Ab617F191dAfeeCfF74FDB38Ae520218fc5D01A",
  "0xf202971A47269DE36B6Bd3fd48b4c1c6EB921D73"
];

// Clique requires signer addresses in extraData sorted ascending.
const sorted = [...signers].map((a) => a.toLowerCase()).sort();

// Clique extraData layout:
//   32 bytes vanity (zero)             -> 64 hex chars
//   N * 20-byte signer address         -> N * 40 hex chars, no "0x"
//   65 bytes seal signature (zero at genesis) -> 130 hex chars
const vanity = "00".repeat(32);
const signerBytes = sorted.map((a) => a.replace(/^0x/, "")).join("");
const seal = "00".repeat(65);
const extradata = "0x" + vanity + signerBytes + seal;

const alloc = {};
for (const addr of sorted) {
  alloc[addr.replace(/^0x/, "")] = {
    balance: "0x200000000000000000000000000000000000000000000000000000000000000"
  };
}

const genesis = {
  config: {
    chainId: 31337,
    homesteadBlock: 0, eip150Block: 0, eip155Block: 0, eip158Block: 0,
    byzantiumBlock: 0, constantinopleBlock: 0, petersburgBlock: 0,
    istanbulBlock: 0, berlinBlock: 0, londonBlock: 0,
    clique: { period: 15, epoch: 30000 }
  },
  difficulty: "1",
  gasLimit: "8000000",
  extradata,
  alloc
};

fs.writeFileSync("genesis.json", JSON.stringify(genesis, null, 2));
console.log("Wrote genesis.json");
console.log("Signers (sorted):", sorted);
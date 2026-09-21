// backend/scripts/dump-vision-layout.js

const path = require("path");
const fs = require("fs");
const vision = require("@google-cloud/vision");

// Load backend/.env
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

// Google Vision service-account credentials
const keyFilename = path.resolve(
  __dirname,
  "../keystore/google-service-account.json"
);

if (!fs.existsSync(keyFilename)) {
  throw new Error(
    `Google Vision credentials not found:\n${keyFilename}`
  );
}

console.log("Using Google Vision credentials:");
console.log(keyFilename);

const client = new vision.ImageAnnotatorClient({
  keyFilename,
});

async function run(n) {
  const imagePath = path.resolve(
    __dirname,
    `receipt-img/receipt (${n}).jpg`
  );

  const outputPath = path.resolve(
    __dirname,
    `receipt-test-results/receipt-${n}-layout.json`
  );

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Receipt image not found:\n${imagePath}`);
  }

  const [result] = await client.documentTextDetection(imagePath);

  const words = (result.textAnnotations || [])
    .slice(1)
    .map((w) => ({
      text: w.description,
      vertices: w.boundingPoly.vertices,
    }));

  fs.writeFileSync(
    outputPath,
    JSON.stringify({ words }, null, 2)
  );

  console.log(`Receipt ${n}: saved ${words.length} words`);
}

(async () => {
  for (let n = 1; n <= 6; n++) {
    await run(n);
  }
})();

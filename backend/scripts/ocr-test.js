require("dotenv").config({ path: "../.env" });


const vision = require("@google-cloud/vision");
const { parseReceiptText } = require("./parser");
const fs = require("fs");

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_VISION_API_KEY,
});

async function run(imagePath) {
  const [result] = await client.textDetection(imagePath);
  const text = result.fullTextAnnotation?.text || "(no text detected)";
  console.log("=== " + imagePath + " ===");
  console.log(text);
  // save the raw output for tomorrow's parser work
  const outName = imagePath.replace(/\.[^.]+$/, "-raw.txt");
  fs.writeFileSync(outName, text);

const parsedReceipt = parseReceiptText(text)
console.log("Parsed:")
console.log(parsedReceipt)



}

run("./receipt-img/receipt (1).jpg");


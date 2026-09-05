function parseReceiptText(rawText) {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  const storeName = lines[0] || null; // heuristic: first line of the receipt

  const tinMatch = rawText.match(/\d{3}\s*-\s*\d{3}\s*-\s*\d{3}/);
  const orSiMatch = rawText.match(/(?:OR|INVOICE|SI|SALES\s*INVOICE\s*NO)\s*#?\s*(\d+)/i);
  const amountMatch = rawText.match(/(?:TOTAL|AMOUNT|Total\s*Amount\s*Due)[\s\S]{0,20}?(\d+[.,]\d{2})/i);
  const dateMatch = rawText.match(/\d{2}\/\d{2}\/\d{4}/);

  return {
    storeName,
    tin: tinMatch ? tinMatch[0] : null,
    orSiNumber: orSiMatch ? orSiMatch[1] : null,
    amount: amountMatch ? amountMatch[1] : null,
    date: dateMatch ? dateMatch[0] : null,
  };
}

module.exports = { parseReceiptText };
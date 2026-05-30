const fs = require("fs");
const pdf = require("pdf-parse");

async function extractPDFText(source) {
  const dataBuffer = Buffer.isBuffer(source)
    ? source
    : fs.readFileSync(source);
  const data = await pdf(dataBuffer);
  return data.text;
}

function chunkText(text, chunkSize = 500) {
  const chunks = [];

  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  return chunks;
}

module.exports = {
  extractPDFText,
  chunkText
};
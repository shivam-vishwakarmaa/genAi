const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { z } = require("zod");
const { PDFParse } = require("pdf-parse");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

function chunkText(text, chunkSize = 500) {
  const cleanText = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const words = cleanText.split(" ");
  let chunks = [];
  let currentChunk = [];

  for (let word of words) {
    currentChunk.push(word);
    if (currentChunk.join(" ").length >= chunkSize) {
      chunks.push(currentChunk.join(" "));
      currentChunk = [];
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }
  return chunks;
}

app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Invalid PDF upload." });
    }

    console.log(`\n--- New Upload Received: ${req.file.originalname} ---`);
    console.log("Extracting text...");

    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const rawText = pdfData.text;

    if (!rawText || rawText.trim() === "") {
      return res
        .status(400)
        .json({ error: "Could not extract text. Is this a scanned image?" });
    }

    console.log("Chunking text...");
    const chunks = chunkText(rawText);

    console.log(
      `Success! Extracted ${rawText.length} characters into ${chunks.length} chunks.`,
    );

    res.status(200).json({
      message: `Successfully extracted ${chunks.length} sections from the PDF!`,
    });
  } catch (error) {
    console.error("Backend Error parsing PDF:", error);
    res
      .status(500)
      .json({ error: "Failed to process document. See backend console." });
  }
});

app.listen(port, () => {
  console.log(`🚀 Local AI Server running at http://localhost:${port}`);
});

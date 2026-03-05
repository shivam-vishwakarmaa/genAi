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

// --- OUR IN-MEMORY VECTOR DATABASE ---
// This will store objects like: { id: "chunk_1", text: "...", embedding: [0.12, -0.45, ...] }
global.vectorDB = [];

// Helper 1: Break text into chunks
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

// Helper 2: Call Local Ollama to get Embeddings
async function getEmbedding(text) {
  try {
    const response = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: text,
      }),
    });

    if (!response.ok)
      throw new Error("Ollama is not running or missing the model.");

    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error("Embedding Error:", error.message);
    throw error;
  }
}

// Endpoint 1: Upload, Extract, Embed, and Store
app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Invalid PDF upload." });
    }

    console.log(`\n--- Processing: ${req.file.originalname} ---`);

    // 1. Read the PDF
    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const rawText = pdfData.text;

    if (!rawText || rawText.trim() === "") {
      return res.status(400).json({ error: "Could not extract text." });
    }

    // 2. Break It Into Pieces
    console.log("Chunking text...");
    const chunks = chunkText(rawText);
    console.log(`Created ${chunks.length} chunks. Generating embeddings...`);

    // 3. Clear the old database for the new document
    global.vectorDB = [];

    // 4. Convert to Numbers and Store It
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
      const embedding = await getEmbedding(chunks[i]);

      global.vectorDB.push({
        id: `chunk_${i}`,
        text: chunks[i],
        embedding: embedding,
        metadata: { source: req.file.originalname, chunkIndex: i },
      });
    }

    console.log(
      `🎉 Success! Vector Database now holds ${global.vectorDB.length} searchable sections.`,
    );

    res.status(200).json({
      message: `Successfully processed and memorized ${chunks.length} sections!`,
    });
  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: "Failed to process document. See console." });
  }
});

// Endpoint 2: Ask a Question (Placeholder for next step)
app.post("/api/chat", async (req, res) => {
  res.status(200).json({ answer: "This is a placeholder.", sources: [] });
});

app.listen(port, () => {
  console.log(`🚀 Local AI Server running at http://localhost:${port}`);
});

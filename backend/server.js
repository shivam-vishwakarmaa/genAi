const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { z } = require("zod");
const { PDFParse } = require("pdf-parse");
const vision = require("@google-cloud/vision");

const app = express();
const port = 3000;

// Initialize Google Vision Client using your key.json
const client = new vision.ImageAnnotatorClient({
  keyFilename: "./key.json",
});

app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

global.vectorDB = [];

const chatSchema = z.object({
  question: z.string().min(1, "Question cannot be empty"),
});

// Helper: Text Chunking
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
  if (currentChunk.length > 0) chunks.push(currentChunk.join(" "));
  return chunks;
}

// Helper: Local Ollama Embeddings
async function getEmbedding(text) {
  const response = await fetch("http://localhost:11434/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
  });
  const data = await response.json();
  return data.embedding;
}

// Helper: Search Logic (Cosine Similarity)
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Endpoint 1: Upload (Handwriting OCR + Local Processing)
app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    console.log(`\n--- New Upload: ${req.file.originalname} ---`);

    // 1. Try standard extract first (for digital PDFs)
    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    let rawText = pdfData.text;

    // 2. Handwriting OCR Fallback
    if (!rawText || rawText.trim().length < 20) {
      console.log(
        "No digital text found. Using Google Vision OCR for handwriting...",
      );
      const [result] = await client.documentTextDetection(req.file.buffer);
      rawText = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
    }

    if (!rawText)
      return res.status(400).json({ error: "Could not read handwriting." });

    console.log("Text successfully extracted. Chunking and Embedding...");
    const chunks = chunkText(rawText);
    global.vectorDB = [];

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await getEmbedding(chunks[i]);
      global.vectorDB.push({
        id: `Section ${i + 1}`,
        text: chunks[i],
        embedding,
      });
    }

    res
      .status(200)
      .json({
        message: `Successfully processed ${chunks.length} handwritten sections!`,
      });
  } catch (error) {
    console.error("OCR/Upload Error:", error);
    res.status(500).json({ error: "Failed to read document." });
  }
});

// Endpoint 2: Local AI Chat
app.post("/api/chat", async (req, res) => {
  try {
    const { question } = chatSchema.parse(req.body);
    const qEmbed = await getEmbedding(question);

    const scored = global.vectorDB.map((c) => ({
      ...c,
      score: cosineSimilarity(qEmbed, c.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);

    const context = top.map((c) => `[${c.id}]: ${c.text}`).join("\n\n");
    const prompt = `Answer the question based ONLY on the notes provided. If unknown, say "I don't know".\n\nNotes:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "phi3", prompt, stream: false }),
    });

    const aiData = await response.json();
    res
      .status(200)
      .json({
        answer: aiData.response,
        sources: top.map((c) => c.id).join(", "),
      });
  } catch (error) {
    res.status(500).json({ error: "Chat processing failed." });
  }
});

app.listen(port, () =>
  console.log(`🚀 OCR-Enabled Server at http://localhost:${port}`),
);

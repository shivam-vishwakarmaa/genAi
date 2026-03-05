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

// --- IN-MEMORY VECTOR DATABASE ---
global.vectorDB = [];

const chatSchema = z.object({
  question: z.string().min(1, "Question cannot be empty"),
});

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

// Helper 2: Get Embeddings from Ollama
async function getEmbedding(text) {
  const response = await fetch("http://localhost:11434/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
  });
  if (!response.ok) throw new Error("Ollama error");
  const data = await response.json();
  return data.embedding;
}

// Helper 3: Cosine Similarity (Math to find the closest matching text)
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

// Endpoint 1: Upload & Store
app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer)
      return res.status(400).json({ error: "Invalid PDF" });

    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    await parser.destroy();

    const chunks = chunkText(pdfData.text);
    global.vectorDB = []; // Clear old doc

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
      .json({ message: `Successfully processed ${chunks.length} sections!` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process document." });
  }
});

// Endpoint 2: The RAG Chat Engine
app.post("/api/chat", async (req, res) => {
  try {
    const { question } = chatSchema.parse(req.body);

    if (global.vectorDB.length === 0) {
      return res.status(400).json({ error: "Please upload a document first." });
    }

    // 1. Convert user question to numbers
    const questionEmbedding = await getEmbedding(question);

    // 2. Search Database (Score all chunks)
    const scoredChunks = global.vectorDB.map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(questionEmbedding, chunk.embedding),
    }));

    // 3. Get Top 3 most relevant chunks
    scoredChunks.sort((a, b) => b.score - a.score);
    const topChunks = scoredChunks.slice(0, 3);

    // 4. Build the Strict Hackathon Prompt
    const contextText = topChunks
      .map((c) => `[${c.id}]: ${c.text}`)
      .join("\n\n");

    const prompt = `You are a strict study assistant. Answer the user's question based ONLY on the provided notes below. If the notes do not contain the answer, say "I don't know". Do NOT make up information.

Notes:
${contextText}

Question: ${question}

Answer:`;

    // 5. Generate Answer via Ollama (Using phi3)
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "phi3",
        prompt: prompt,
        stream: false,
      }),
    });

    const aiData = await response.json();

    // 6. Format source citations
    const sources = topChunks.map((c) => c.id).join(", ");

    res.status(200).json({
      answer: aiData.response,
      sources: sources,
    });
  } catch (error) {
    console.error("Chat Error:", error);
    res.status(500).json({ error: "Failed to generate answer." });
  }
});

app.listen(port, () =>
  console.log(`🚀 Local AI Server running at http://localhost:${port}`),
);

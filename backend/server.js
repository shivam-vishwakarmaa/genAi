require("dotenv").config();
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { z } = require("zod");
const { PDFParse } = require("pdf-parse");
const vision = require("@google-cloud/vision");
const { ChromaClient } = require("chromadb");

const app = express();

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "phi3";
const GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
const CHROMA_URL = process.env.CHROMA_URL || "";
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "study_assistant";
const MAX_UPLOAD_MB = Number.parseInt(process.env.MAX_UPLOAD_MB || "25", 10);
const TOP_K = Number.parseInt(process.env.TOP_K || "3", 10);
const MIN_SIMILARITY = Number.parseFloat(process.env.MIN_SIMILARITY || "0.2");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const looksLikePdf =
      file.mimetype === "application/pdf" ||
      (file.originalname || "").toLowerCase().endsWith(".pdf");
    if (!looksLikePdf) {
      return cb(new Error("Only PDF files are supported."));
    }
    return cb(null, true);
  },
});

const chatSchema = z.object({
  question: z.string().min(1, "Question cannot be empty").max(5000),
});

const state = {
  activeDocumentId: null,
  documents: new Map(),
};

let visionClient = null;
let chromaClient = null;
let chromaCollection = null;
let chromaReady = false;
let chromaLastError = null;

function buildError(message, status = 500, details = null) {
  const err = new Error(message);
  err.status = status;
  err.details = details;
  return err;
}

function sendError(res, error, fallbackMessage) {
  const status = error?.status || 500;
  const message = error?.message || fallbackMessage;
  const payload = { error: message };
  if (error?.details) payload.details = error.details;
  return res.status(status).json(payload);
}

function chunkText(text, chunkSize = 600, overlap = 120) {
  const cleanText = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleanText) return [];

  const chunks = [];
  let start = 0;

  while (start < cleanText.length) {
    const end = Math.min(start + chunkSize, cleanText.length);
    const chunk = cleanText.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= cleanText.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function getEmbedding(text) {
  const { ok, status, data } = await fetchJson(
    `${OLLAMA_BASE_URL}/api/embeddings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
    },
  );

  if (!ok || !Array.isArray(data.embedding)) {
    throw buildError(
      `Embedding failed (status ${status}). Ensure Ollama is running and model "${OLLAMA_EMBED_MODEL}" is installed.`,
      502,
      data,
    );
  }

  return data.embedding;
}

async function generateAnswer(prompt) {
  const { ok, status, data } = await fetchJson(
    `${OLLAMA_BASE_URL}/api/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_CHAT_MODEL, prompt, stream: false }),
    },
  );

  if (!ok) {
    throw buildError(
      `Answer generation failed (status ${status}). Ensure model "${OLLAMA_CHAT_MODEL}" is available.`,
      502,
      data,
    );
  }

  if (data.error) {
    throw buildError(`Ollama error: ${data.error}`, 502, data);
  }

  return data.response || "I don't know";
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return -1;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i += 1) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return -1;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getVisionClient() {
  if (!visionClient) {
    const options = GOOGLE_APPLICATION_CREDENTIALS
      ? { keyFilename: GOOGLE_APPLICATION_CREDENTIALS }
      : {};
    visionClient = new vision.ImageAnnotatorClient(options);
  }
  return visionClient;
}

async function ensureChroma() {
  if (!CHROMA_URL) return null;
  if (chromaCollection) return chromaCollection;

  try {
    chromaClient = new ChromaClient({ path: CHROMA_URL });
    chromaCollection = await chromaClient.getOrCreateCollection({
      name: CHROMA_COLLECTION,
      metadata: { app: "study-assistant-ai" },
    });
    chromaReady = true;
    chromaLastError = null;
    return chromaCollection;
  } catch (error) {
    chromaReady = false;
    chromaLastError = error.message;
    return null;
  }
}

async function upsertDocumentToChroma(doc) {
  const collection = await ensureChroma();
  if (!collection) return;

  await collection.upsert({
    ids: doc.chunks.map((c) => c.id),
    embeddings: doc.chunks.map((c) => c.embedding),
    documents: doc.chunks.map((c) => c.text),
    metadatas: doc.chunks.map((c) => ({
      documentId: doc.id,
      fileName: doc.fileName,
      chunkIndex: c.chunkIndex,
      sourceLabel: c.sourceLabel,
      createdAt: doc.createdAt,
    })),
  });
}

async function deleteDocumentFromChroma(documentId) {
  const collection = await ensureChroma();
  if (!collection) return;

  await collection.delete({
    where: { documentId: { $eq: documentId } },
  });
}

async function hydrateMemoryFromChroma() {
  const collection = await ensureChroma();
  if (!collection) return;

  try {
    const result = await collection.get({
      include: ["metadatas", "documents", "embeddings"],
    });

    const grouped = new Map();
    const ids = result.ids || [];
    const docs = result.documents || [];
    const metadatas = result.metadatas || [];
    const embeddings = result.embeddings || [];

    for (let i = 0; i < ids.length; i += 1) {
      const metadata = metadatas[i] || {};
      const documentId = metadata.documentId;
      if (!documentId) continue;

      if (!grouped.has(documentId)) {
        grouped.set(documentId, {
          id: documentId,
          fileName: metadata.fileName || "Recovered Document",
          createdAt: metadata.createdAt || new Date().toISOString(),
          chunks: [],
        });
      }

      grouped.get(documentId).chunks.push({
        id: ids[i],
        text: docs[i] || "",
        embedding: embeddings[i] || [],
        chunkIndex: Number(metadata.chunkIndex || 0),
        sourceLabel: metadata.sourceLabel || `Section ${i + 1}`,
      });
    }

    state.documents = grouped;
    const latest = [...grouped.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    )[0];
    state.activeDocumentId = latest ? latest.id : null;
  } catch (error) {
    chromaLastError = `Hydration failed: ${error.message}`;
  }
}

app.get("/api/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "study-assistant-backend",
    timestamp: new Date().toISOString(),
    activeDocumentId: state.activeDocumentId,
    documentCount: state.documents.size,
  });
});

app.get("/api/deps", async (req, res) => {
  const credPath = GOOGLE_APPLICATION_CREDENTIALS || "(not set)";
  const credFileFound = GOOGLE_APPLICATION_CREDENTIALS
    ? fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS)
    : false;

  const ollama = await fetchJson(`${OLLAMA_BASE_URL}/api/tags`, {}, 4000).catch(
    (error) => ({
      ok: false,
      status: 0,
      data: { error: error.message },
    }),
  );

  const modelNames = Array.isArray(ollama.data?.models)
    ? ollama.data.models.map((m) => m.name)
    : [];

  await ensureChroma();

  res.status(200).json({
    backend: { ok: true, port: PORT },
    ollama: {
      ok: ollama.ok,
      baseUrl: OLLAMA_BASE_URL,
      embedModel: OLLAMA_EMBED_MODEL,
      chatModel: OLLAMA_CHAT_MODEL,
      installedModels: modelNames,
      error: ollama.ok ? null : ollama.data?.error || "Unable to connect",
    },
    vision: {
      credentialsPath: credPath,
      credentialsFileFound: credFileFound,
      configured: Boolean(GOOGLE_APPLICATION_CREDENTIALS),
    },
    chroma: {
      configured: Boolean(CHROMA_URL),
      url: CHROMA_URL || "(not set)",
      collection: CHROMA_COLLECTION,
      ready: chromaReady,
      error: chromaLastError,
    },
  });
});

app.get("/api/documents", (req, res) => {
  const documents = [...state.documents.values()]
    .map((d) => ({
      id: d.id,
      fileName: d.fileName,
      chunkCount: d.chunks.length,
      createdAt: d.createdAt,
      isActive: d.id === state.activeDocumentId,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  res.status(200).json({ documents, activeDocumentId: state.activeDocumentId });
});

app.delete("/api/document/:id", async (req, res) => {
  const { id } = req.params;
  if (!state.documents.has(id)) {
    return res.status(404).json({ error: "Document not found." });
  }

  state.documents.delete(id);

  try {
    await deleteDocumentFromChroma(id);
  } catch (error) {
    chromaLastError = `Delete failed: ${error.message}`;
  }

  if (state.activeDocumentId === id) {
    const next = [...state.documents.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    )[0];
    state.activeDocumentId = next ? next.id : null;
  }

  return res.status(200).json({
    message: "Document deleted.",
    activeDocumentId: state.activeDocumentId,
  });
});

app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      throw buildError("Invalid upload. Please select a PDF file.", 400);
    }

    console.log(`\n--- Upload received: ${req.file.originalname} ---`);
    const parser = new PDFParse({ data: req.file.buffer });
    let rawText = "";
    let usedOcr = false;

    try {
      const pdfData = await parser.getText();
      rawText = pdfData?.text || "";
    } finally {
      await parser.destroy().catch(() => {});
    }

    if (!rawText || rawText.trim().length < 20) {
      console.log("No digital text found. Trying Google Vision OCR...");
      usedOcr = true;
      const client = getVisionClient();
      const [result] = await client.documentTextDetection(req.file.buffer);
      rawText = result?.fullTextAnnotation?.text || "";
    }

    if (!rawText || rawText.trim().length < 20) {
      throw buildError(
        "Could not extract readable text from this PDF. Try a clearer scan.",
        400,
      );
    }

    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      throw buildError("Document is empty after text extraction.", 400);
    }

    const docId = `doc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const doc = {
      id: docId,
      fileName: req.file.originalname,
      createdAt: new Date().toISOString(),
      chunks: [],
    };

    for (let i = 0; i < chunks.length; i += 1) {
      const embedding = await getEmbedding(chunks[i]);
      doc.chunks.push({
        id: `${docId}_chunk_${i + 1}`,
        sourceLabel: `Section ${i + 1}`,
        chunkIndex: i + 1,
        text: chunks[i],
        embedding,
      });
    }

    state.documents.set(docId, doc);
    state.activeDocumentId = docId;

    try {
      await upsertDocumentToChroma(doc);
    } catch (error) {
      chromaLastError = `Upsert failed: ${error.message}`;
    }

    return res.status(200).json({
      message: `Successfully extracted and indexed ${doc.chunks.length} sections.`,
      documentId: doc.id,
      fileName: doc.fileName,
      chunkCount: doc.chunks.length,
      usedOcr,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return sendError(res, error, "Failed to process document.");
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { question } = chatSchema.parse(req.body);

    if (!state.activeDocumentId || !state.documents.has(state.activeDocumentId)) {
      throw buildError("Please upload a document first.", 400);
    }

    const activeDoc = state.documents.get(state.activeDocumentId);
    const questionEmbedding = await getEmbedding(question);

    const ranked = activeDoc.chunks
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(questionEmbedding, chunk.embedding),
      }))
      .filter((chunk) => chunk.score >= MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    if (ranked.length === 0) {
      return res.status(200).json({
        answer: "I don't know",
        sources: "",
      });
    }

    const context = ranked
      .map((c) => `[${c.sourceLabel}] ${c.text}`)
      .join("\n\n");

    const prompt = `You are a strict study assistant.
Answer using ONLY the notes below.
If the answer is not present, reply exactly: "I don't know".

Notes:
${context}

Question: ${question}

Answer:`;

    const answer = await generateAnswer(prompt);
    return res.status(200).json({
      answer,
      sources: ranked.map((c) => c.sourceLabel).join(", "),
      documentId: activeDoc.id,
      fileName: activeDoc.fileName,
    });
  } catch (error) {
    console.error("Chat error:", error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid question payload." });
    }
    return sendError(res, error, "Chat processing failed.");
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: `File too large. Maximum allowed is ${MAX_UPLOAD_MB}MB.` });
    }
    return res.status(400).json({ error: err.message });
  }

  if (err?.message) {
    return res.status(400).json({ error: err.message });
  }

  return next(err);
});

hydrateMemoryFromChroma().finally(() => {
  app.listen(PORT, () => {
    console.log(`Study Assistant backend running at http://localhost:${PORT}`);
    console.log(`Ollama: ${OLLAMA_BASE_URL}`);
    if (GOOGLE_APPLICATION_CREDENTIALS) {
      console.log(`Vision credentials: ${GOOGLE_APPLICATION_CREDENTIALS}`);
    } else {
      console.log("Vision credentials: not set (OCR fallback may fail)");
    }
    if (CHROMA_URL) {
      console.log(`Chroma: ${CHROMA_URL} (collection: ${CHROMA_COLLECTION})`);
    } else {
      console.log("Chroma: not configured (memory-only mode)");
    }
  });
});

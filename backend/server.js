const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { z } = require('zod');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Set up Multer to store uploaded PDFs in memory
const upload = multer({ storage: multer.memoryStorage() });

// Zod schema for chat validation
const chatSchema = z.object({
  question: z.string().min(1, "Question cannot be empty"),
});

// Endpoint 1: Upload and Process PDF
app.post('/api/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });

    // TODO: Step 1 - Send req.file.buffer to Cloud OCR to read handwritten text
    // TODO: Step 2 - Break text into chunks
    // TODO: Step 3 - Generate embeddings via Ollama (nomic-embed-text)
    // TODO: Step 4 - Store chunks and embeddings in local ChromaDB

    res.status(200).json({ message: 'PDF processed and stored locally!' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process document' });
  }
});

// Endpoint 2: Ask a Question (RAG Workflow)
app.post('/api/chat', async (req, res) => {
  try {
    // Validate request body
    const { question } = chatSchema.parse(req.body);

    // TODO: Step 1 - Convert the question into an embedding via Ollama
    // TODO: Step 2 - Search local ChromaDB for the most relevant text chunks
    // TODO: Step 3 - Send the chunks + question to Ollama (phi3) to generate an answer
    // TODO: Step 4 - Return the answer and the source references to the mobile app

    res.status(200).json({ answer: "This is a placeholder answer.", sources: [] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Local AI Server running at http://localhost:${port}`);
});
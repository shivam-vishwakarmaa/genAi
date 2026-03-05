const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { z } = require('zod');
const pdfParse = require('pdf-parse');

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

// Helper function: Breaks large text into smaller chunks
function chunkText(text, chunkSize = 500) {
  const cleanText = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleanText.split(' ');
  let chunks = [];
  let currentChunk = [];

  for (let word of words) {
    currentChunk.push(word);
    if (currentChunk.join(' ').length >= chunkSize) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [];
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  return chunks;
}

// Endpoint 1: Upload and Process PDF
app.post('/api/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    
    console.log(`\n--- New Upload Received: ${req.file.originalname} ---`);

    // Step 1: Read the PDF
    console.log("Extracting text...");
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text;

    if (!rawText || rawText.trim() === '') {
      return res.status(400).json({ error: 'Could not extract text. Is this a scanned image?' });
    }

    // Step 2: Break It Into Pieces
    console.log("Chunking text...");
    const chunks = chunkText(rawText);
    
    console.log(`Success! Extracted ${rawText.length} characters into ${chunks.length} chunks.`);
    if (chunks.length > 0) {
      console.log(`Preview: "${chunks[0].substring(0, 50)}..."`);
    }

    res.status(200).json({ message: `Successfully extracted ${chunks.length} sections from the PDF!` });
  } catch (error) {
    console.error("Error processing document:", error);
    res.status(500).json({ error: 'Failed to process document' });
  }
});

// Endpoint 2: Ask a Question
app.post('/api/chat', async (req, res) => {
  try {
    const { question } = chatSchema.parse(req.body);
    res.status(200).json({ answer: "This is a placeholder answer.", sources: [] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Local AI Server running at http://localhost:${port}`);
});
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Load .env file manually if it exists
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!process.env[key]) process.env[key] = value.trim();
      }
    });
  }
} catch (e) {
  console.error("Error reading .env file", e);
}
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';

import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';


// Initialize Express
const app = express();
const PORT = 3000;

// Setup Middlewares
app.use(cors());
app.use(express.json());

// Set up Multer for file uploads
const uploadDir = path.join(os.tmpdir(), 'pdf-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Lazy Initialize Gemini API
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

// API Route: Upload PDF and get Gemini File URI
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    let filePath = req.file.path;
    let mimeType = req.file.mimetype;
    let isTempFile = false;

    // Handle older .doc explicitly
    let extractedText = null;
    let extractedHtml = null;

    if (mimeType === 'application/msword' || req.file.originalname.toLowerCase().endsWith('.doc')) {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(req.file.path);
      extractedText = extracted.getBody();
      const tempTextPath = req.file.path + '.txt';
      fs.writeFileSync(tempTextPath, extractedText);
      filePath = tempTextPath;
      mimeType = 'text/plain';
      isTempFile = true;
    }

    // Handle .docx explicitly
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || req.file.originalname.toLowerCase().endsWith('.docx')) {
      const htmlResult = await mammoth.convertToHtml({ path: req.file.path });
      extractedHtml = htmlResult.value;
      
      const result = await mammoth.extractRawText({ path: req.file.path });
      extractedText = result.value;
      const tempTextPath = req.file.path + '.txt';
      fs.writeFileSync(tempTextPath, extractedText);
      filePath = tempTextPath;
      mimeType = 'text/plain';
      isTempFile = true;
    }

    // Upload the file to Gemini File API
    const uploadResult = await getAiClient().files.upload({
      file: filePath,
      config: {
        mimeType: mimeType,
        displayName: req.file.originalname,
      }
    });
    
    // Clean up local temp files
    fs.unlinkSync(req.file.path);
    if (isTempFile) {
      fs.unlinkSync(filePath);
    }

    // Wait until the file is active
    let fileState = await getAiClient().files.get({ name: uploadResult.name });
    while (fileState.state === 'PROCESSING') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      fileState = await getAiClient().files.get({ name: uploadResult.name });
    }
    
    if (fileState.state === 'FAILED') {
      throw new Error('Gemini failed to process the file.');
    }
    
    // Return the file reference from Gemini
    res.json({
      name: uploadResult.name,
      uri: uploadResult.uri,
      mimeType: mimeType,
      displayName: uploadResult.displayName,
      extractedText,
      extractedHtml
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to upload document to AI provider.' });
  }
});

// API Route: Chat with the document
app.post('/api/chat', async (req, res) => {
  try {
    const { documentUri, mimeType = 'application/pdf', messages } = req.body;
    
    if (!documentUri || !messages) {
      return res.status(400).json({ error: 'Missing document or messages' });
    }
    
    // Prepare the system instruction
    const systemInstruction = `
Sen akıllı bir asistanısın. Sana sağlanan belgeye dayanarak kullanıcının sorularını yanıtla.
Kullanıcıya her zaman dostça ve profesyonel bir dille (Türkçe) hitap et.
Eğer belge bir PDF ise, yanıtlarında belgeden referans verirken ilgili sayfa numarasını [Sayfa X] (örneğin [Sayfa 5], [Sayfa 12]) formatında belirt.
Bu format çok önemli çünkü arayüz bu formatı algılayıp tıklanabilir bağlantılara dönüştürecek.
Eğer aradıkları bilgi belgede yoksa, bunu kibarca belirt ve tahmin yürütme.
    `.trim();

    // Setup chat format
    const chatContents = messages.map((m: any) => ({
      role: m.role,
      parts: [{ text: m.text }]
    }));

    // Generate content
    const responseStream = await getAiClient().models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ fileData: { fileUri: documentUri, mimeType: mimeType } }] },
        ...chatContents
      ],
      config: {
        systemInstruction,
        temperature: 0.2, // Low temperature for factual Q&A
      }
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of responseStream) {
      res.write(chunk.text);
    }
    res.end();
  } catch (error: any) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: 'Failed to generate chat response.', details: error.message });
  }
});

// API Route: Quick Actions (Summarize, Translate, Rephrase)
app.post('/api/action', async (req, res) => {
  try {
    const { action, text, documentName, pageNumber } = req.body;
    
    let prompt = '';
    if (action === 'summarize') {
      prompt = 'Lütfen aşağıdaki metni kısaca özetle.';
    } else if (action === 'translate') {
      prompt = 'Lütfen aşağıdaki metni Türkçeye çevir (Eğer Türkçeyse İngilizceye çevir).';
    } else if (action === 'rephrase') {
      prompt = 'Lütfen aşağıdaki metni daha akıcı ve profesyonel bir şekilde yeniden yaz.';
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const responseStream = await getAiClient().models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: prompt + '\\n\\nMetin:\\n' + text }] }
      ],
      config: { temperature: 0.3 }
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of responseStream) {
      res.write(chunk.text);
    }
    res.end();
  } catch (error) {
    console.error('Action Error:', error);
    res.status(500).json({ error: 'Failed to process action.' });
  }
});

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup Vite for Development & Static Serving for Production
export async function startServer() {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    const viteName = 'vite';
    const viteModule = await import(/* @vite-ignore */ viteName);
    const vite = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // When running as a compiled standalone executable (e.g. applet.exe)
    // we assume the dist folder is next to the executable
    let distPath = path.join(path.dirname(process.execPath), 'dist');
    if (!fs.existsSync(distPath)) {
       // fallback for normal node execution or different __dirname layout
       distPath = path.join(process.cwd(), 'dist');
    }
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return new Promise((resolve) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('Server is running on http://localhost:' + PORT);
      
      // Automatically open the user's default browser if we are not in dev
      if (!isDev) {
        import('child_process').then(({ exec }) => {
          let command = 'start http://localhost:' + PORT;
          if (process.platform === 'darwin') command = 'open http://localhost:' + PORT;
          else if (process.platform === 'linux') command = 'xdg-open http://localhost:' + PORT;
          exec(command);
        });
      }
      
      resolve(server);
    });
  });
}

// Always start the server when this script is run
startServer();

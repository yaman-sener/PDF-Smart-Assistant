process.env.NODE_ENV = process.env.NODE_ENV || 'production';

import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { fileURLToPath } from 'url';

// Helper: Strictly validate if an API key is real and not a dummy placeholder
export function isValidApiKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (trimmed.length < 20) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('your_gemini_api_key') ||
    lower.includes('your_api_key') ||
    lower.includes('my_gemini_api_key') ||
    lower.includes('placeholder') ||
    lower.includes('aizasy...') ||
    lower.includes('test_key') ||
    lower === 'aizasy'
  ) {
    return false;
  }
  return true;
}

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
  console.error('Error reading .env file', e);
}

// Persistent user config folder for caching API keys across program sessions
const USER_CONFIG_DIR = path.join(os.homedir(), '.pdf-smart-assistant');
const USER_KEY_FILE = path.join(USER_CONFIG_DIR, 'cached_key.json');

let cachedDiskApiKey = '';

function loadCachedDiskApiKey(): string {
  try {
    if (fs.existsSync(USER_KEY_FILE)) {
      const data = JSON.parse(fs.readFileSync(USER_KEY_FILE, 'utf-8'));
      if (data && typeof data.apiKey === 'string' && isValidApiKey(data.apiKey)) {
        cachedDiskApiKey = data.apiKey.trim();
        return cachedDiskApiKey;
      }
    }
  } catch (e) {
    console.error('Failed to load cached API key from disk:', e);
  }
  cachedDiskApiKey = '';
  return '';
}

function saveCachedDiskApiKey(apiKey: string): void {
  try {
    if (!isValidApiKey(apiKey)) return;
    if (!fs.existsSync(USER_CONFIG_DIR)) {
      fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(USER_KEY_FILE, JSON.stringify({ apiKey: apiKey.trim(), updatedAt: new Date().toISOString() }), 'utf-8');
    cachedDiskApiKey = apiKey.trim();
  } catch (e) {
    console.error('Failed to save cached API key to disk:', e);
  }
}

function removeCachedDiskApiKey(): void {
  try {
    if (fs.existsSync(USER_KEY_FILE)) {
      fs.unlinkSync(USER_KEY_FILE);
    }
    cachedDiskApiKey = '';
  } catch (e) {
    console.error('Failed to remove cached API key from disk:', e);
  }
}

// Initialize cached key from disk on startup
loadCachedDiskApiKey();

// Initialize Express
const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Security Middlewares: Security headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Configure CORS
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-gemini-api-key', 'Authorization']
}));

// Body Parser with strict size limit to avoid memory exhaustion
app.use(express.json({ limit: '10mb' }));

// Set up Multer for secure file uploads
const uploadDir = path.join(os.tmpdir(), 'pdf-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Whitelist allowed MIME types and file extensions
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/jpg'
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg']);

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Desteklenmeyen dosya türü. Yalnızca PDF, Word, Görsel ve Metin dosyaları kabul edilir.'));
    }
  }
});

// Cache AI clients by API key
const clientCache = new Map<string, GoogleGenAI>();

/**
 * Helper to mask an API key for safe UI display (e.g. AIzaSy...xxxx)
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

/**
 * Resolves GoogleGenAI client from:
 * 1. Request header 'x-gemini-api-key' (if valid non-placeholder)
 * 2. Cached disk key in ~/.pdf-smart-assistant/cached_key.json
 * 3. process.env.GEMINI_API_KEY (if valid non-placeholder)
 */
function resolveAiClient(req: Request): GoogleGenAI {
  const customKey = (req.headers['x-gemini-api-key'] as string | undefined)?.trim();
  const validCustomKey = isValidApiKey(customKey) ? customKey : null;
  const validDiskKey = isValidApiKey(cachedDiskApiKey) ? cachedDiskApiKey : null;
  const validEnvKey = isValidApiKey(process.env.GEMINI_API_KEY) ? process.env.GEMINI_API_KEY?.trim() : null;

  const apiKey = validCustomKey || validDiskKey || validEnvKey;

  if (!apiKey) {
    const error: any = new Error('GEMINI_API_KEY_REQUIRED');
    error.status = 401;
    throw error;
  }

  let client = clientCache.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    if (clientCache.size > 50) {
      const firstKey = clientCache.keys().next().value;
      if (firstKey) clientCache.delete(firstKey);
    }
    clientCache.set(apiKey, client);
  }
  return client;
}

// API Route: Check server configuration, cached keys & health
app.get('/api/config', (req: Request, res: Response) => {
  const hasEnvKey = isValidApiKey(process.env.GEMINI_API_KEY);
  const hasDiskKey = isValidApiKey(cachedDiskApiKey);
  const activeKey = hasDiskKey ? cachedDiskApiKey : (hasEnvKey ? (process.env.GEMINI_API_KEY || '') : '');
  
  res.json({
    hasServerApiKey: hasEnvKey,
    hasCachedDiskKey: hasDiskKey,
    hasAnyValidKey: Boolean(activeKey),
    cachedKeyMasked: activeKey ? maskApiKey(activeKey) : '',
    cachedKey: hasDiskKey ? cachedDiskApiKey : '',
    maxUploadSizeMB: 50
  });
});

// API Route: Save & cache API key persistently on machine
app.post('/api/key/save', (req: Request, res: Response) => {
  const { apiKey } = req.body;
  if (!isValidApiKey(apiKey)) {
    return res.status(400).json({ error: 'Geçersiz API anahtarı. Lütfen geçerli bir Google Gemini API anahtarı girin.' });
  }

  saveCachedDiskApiKey(apiKey.trim());
  res.json({
    success: true,
    message: 'API anahtarı kalıcı olarak kaydedildi.',
    maskedKey: maskApiKey(apiKey.trim())
  });
});

// API Route: Remove cached API key from machine
app.post('/api/key/remove', (req: Request, res: Response) => {
  removeCachedDiskApiKey();
  res.json({
    success: true,
    message: 'Kaydedilmiş API anahtarı başarıyla kaldırıldı.'
  });
});

// API Route: Test API key validity against Gemini 2.5 Flash
app.post('/api/test-key', async (req: Request, res: Response) => {
  try {
    const customKey = (req.headers['x-gemini-api-key'] as string | undefined)?.trim();
    if (customKey && !isValidApiKey(customKey)) {
      return res.status(400).json({ error: 'Geçersiz API anahtarı formatı. Lütfen Google AI Studio\'dan aldığınız anahtarı yapıştırın.' });
    }

    const aiClient = resolveAiClient(req);
    const result = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Ping',
    });
    if (result) {
      return res.json({ success: true, message: 'Bağlantı Başarılı! Gemini 2.5 Flash ile iletişim kuruldu.' });
    }
    return res.status(400).json({ success: false, message: 'API yanıt vermedi.' });
  } catch (error: any) {
    if (error.message === 'GEMINI_API_KEY_REQUIRED') {
      return res.status(401).json({ error: 'API anahtarı girilmedi veya geçersiz.' });
    }
    return res.status(400).json({ error: 'API anahtarı doğrulanamadı: ' + (error.message || 'Geçersiz anahtar') });
  }
});

// API Route: Upload Document and get Gemini File URI
app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
  const uploadedPath = req.file?.path;
  let tempConvertedPath: string | null = null;

  try {
    if (!req.file || !uploadedPath) {
      return res.status(400).json({ error: 'Yüklenecek dosya bulunamadı.' });
    }

    const aiClient = resolveAiClient(req);

    let filePath = uploadedPath;
    let mimeType = req.file.mimetype;
    let extractedText: string | null = null;
    let extractedHtml: string | null = null;

    const lowerName = req.file.originalname.toLowerCase();

    // Handle older .doc explicitly
    if (mimeType === 'application/msword' || lowerName.endsWith('.doc')) {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(uploadedPath);
      extractedText = extracted.getBody();
      tempConvertedPath = uploadedPath + '.txt';
      fs.writeFileSync(tempConvertedPath, extractedText, 'utf-8');
      filePath = tempConvertedPath;
      mimeType = 'text/plain';
    }

    // Handle .docx explicitly
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
      const htmlResult = await mammoth.convertToHtml({ path: uploadedPath });
      extractedHtml = htmlResult.value;

      const result = await mammoth.extractRawText({ path: uploadedPath });
      extractedText = result.value;
      tempConvertedPath = uploadedPath + '.txt';
      fs.writeFileSync(tempConvertedPath, extractedText, 'utf-8');
      filePath = tempConvertedPath;
      mimeType = 'text/plain';
    }

    // Sanitize displayName for Gemini
    const safeDisplayName = path.basename(req.file.originalname).slice(0, 120);

    // Upload the file to Gemini File API
    const uploadResult = await aiClient.files.upload({
      file: filePath,
      config: {
        mimeType: mimeType,
        displayName: safeDisplayName,
      }
    });

    // Wait until the file is active (timeout after 60s)
    let fileState = await aiClient.files.get({ name: uploadResult.name });
    let attempts = 0;
    while (fileState.state === 'PROCESSING' && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      fileState = await aiClient.files.get({ name: uploadResult.name });
      attempts++;
    }

    if (fileState.state === 'FAILED') {
      throw new Error('Gemini belgeyi işleyemedi.');
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
  } catch (error: any) {
    console.error('Upload Error:', error);
    if (error.message === 'GEMINI_API_KEY_REQUIRED') {
      return res.status(401).json({ error: 'GEMINI_API_KEY_REQUIRED', message: 'Gemini API anahtarı gereklidir.' });
    }
    res.status(500).json({ error: error.message || 'Belge AI sunucusuna yüklenirken bir hata oluştu.' });
  } finally {
    // Unconditionally cleanup all temporary files from disk
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      try { fs.unlinkSync(uploadedPath); } catch {}
    }
    if (tempConvertedPath && fs.existsSync(tempConvertedPath)) {
      try { fs.unlinkSync(tempConvertedPath); } catch {}
    }
  }
});

// API Route: Chat with the document
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { documentUri, mimeType = 'application/pdf', messages } = req.body;

    if (!documentUri || typeof documentUri !== 'string') {
      return res.status(400).json({ error: 'Geçersiz veya eksik belge URI' });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Mesaj listesi boş olamaz.' });
    }

    if (messages.length > 100) {
      return res.status(400).json({ error: 'Mesaj geçmişi sınırı aşıldı.' });
    }

    const aiClient = resolveAiClient(req);

    // Prepare the system instruction
    const systemInstruction = `
Sen akıllı bir asistanısın. Sana sağlanan belgeye dayanarak kullanıcının sorularını yanıtla.
Kullanıcıya her zaman dostça ve profesyonel bir dille (Türkçe) hitap et.
Eğer belge bir PDF ise, yanıtlarında belgeden referans verirken ilgili sayfa numarasını [Sayfa X] (örneğin [Sayfa 5], [Sayfa 12]) formatında belirt.
Bu format çok önemli çünkü arayüz bu formatı algılayıp tıklanabilir bağlantılara dönüştürecek.
Eğer aradıkları bilgi belgede yoksa, bunu kibarca belirt ve tahmin yürütme.
    `.trim();

    // Sanitize chat contents
    const chatContents = messages.map((m: any) => ({
      role: m.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(m.text || '').slice(0, 50000) }]
    }));

    // Generate stream content
    const responseStream = await aiClient.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ fileData: { fileUri: documentUri, mimeType: String(mimeType) } }] },
        ...chatContents
      ],
      config: {
        systemInstruction,
        temperature: 0.2, // Low temperature for factual Q&A
      }
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(chunk.text);
      }
    }
    res.end();
  } catch (error: any) {
    console.error('Chat Error:', error);
    if (error.message === 'GEMINI_API_KEY_REQUIRED') {
      return res.status(401).json({ error: 'GEMINI_API_KEY_REQUIRED', message: 'Gemini API anahtarı gereklidir.' });
    }
    res.status(500).json({ error: error.message || 'Sohbet yanıtı oluşturulurken bir hata meydana geldi.' });
  }
});

// API Route: Quick Actions (Summarize, Translate, Rephrase)
app.post('/api/action', async (req: Request, res: Response) => {
  try {
    const { action, text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'İşlenecek metin bulunamadı.' });
    }

    const safeText = text.slice(0, 50000);

    let prompt = '';
    if (action === 'summarize') {
      prompt = 'Lütfen aşağıdaki metni kısaca ve maddeler halinde özetle.';
    } else if (action === 'translate') {
      prompt = 'Lütfen aşağıdaki metni Türkçeye çevir (Eğer orijinal metin zaten Türkçeyse İngilizceye çevir).';
    } else if (action === 'rephrase') {
      prompt = 'Lütfen aşağıdaki metni daha akıcı, profesyonel ve dil bilgisi kurallarına uygun şekilde yeniden yaz.';
    } else {
      return res.status(400).json({ error: 'Geçersiz işlem tipi.' });
    }

    const aiClient = resolveAiClient(req);

    const responseStream = await aiClient.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: `${prompt}\n\nMetin:\n${safeText}` }] }
      ],
      config: { temperature: 0.3 }
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(chunk.text);
      }
    }
    res.end();
  } catch (error: any) {
    console.error('Action Error:', error);
    if (error.message === 'GEMINI_API_KEY_REQUIRED') {
      return res.status(401).json({ error: 'GEMINI_API_KEY_REQUIRED', message: 'Gemini API anahtarı gereklidir.' });
    }
    res.status(500).json({ error: error.message || 'İşlem gerçekleştirilirken bir hata oluştu.' });
  }
});

// Setup Vite for Development & Static Serving for Production
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    let distPath = path.join(path.dirname(process.execPath), 'dist');
    if (!fs.existsSync(distPath)) {
      distPath = path.join(process.cwd(), 'dist');
    }
    app.use(express.static(distPath));
    app.get('*all', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return new Promise((resolve) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n========================================`);
      console.log(`📑 PDF Smart Assistant is running!`);
      console.log(`🌐 Local URL: http://localhost:${PORT}`);
      console.log(`💾 Persistent Key Cache: ${USER_KEY_FILE}`);
      console.log(`🔒 Security headers & validation enabled`);
      console.log(`========================================\n`);

      // Safely open browser in non-dev mode
      if (!isDev) {
        import('child_process').then(({ exec }) => {
          const safePort = Number(PORT) || 3000;
          let command = `start http://localhost:${safePort}`;
          if (process.platform === 'darwin') command = `open http://localhost:${safePort}`;
          else if (process.platform === 'linux') command = `xdg-open http://localhost:${safePort}`;
          exec(command);
        });
      }

      resolve(server);
    });
  });
}

// Start server
startServer();

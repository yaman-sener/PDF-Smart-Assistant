process.env.NODE_ENV = process.env.NODE_ENV || 'production';

import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';

// =================================================================
// 1. CONFIGURATION & PERSISTENT STORAGE
// =================================================================

const USER_CONFIG_DIR = path.join(os.homedir(), '.pdf-smart-assistant');
const USER_KEY_FILE = path.join(USER_CONFIG_DIR, 'cached_key.json');
const ADMIN_CONFIG_FILE = path.join(USER_CONFIG_DIR, 'admin_config.json');

if (!fs.existsSync(USER_CONFIG_DIR)) {
  fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
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

// Helper: Strictly validate if an API key is real and not a placeholder
export function isValidApiKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (trimmed.length < 15) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('your_gemini_api_key') ||
    lower.includes('your_api_key') ||
    lower.includes('placeholder') ||
    lower.includes('aizasy...') ||
    lower.includes('test_key') ||
    lower === 'aizasy'
  ) {
    return false;
  }
  return true;
}

// =================================================================
// 2. ADMIN AUTHENTICATION & MULTI-MODEL PROVIDERS
// =================================================================

export interface ProviderConfig {
  id: 'gemini' | 'deepseek' | 'kimi';
  name: string;
  enabled: boolean;
  apiKey: string;
  model: string;
  priority: number;
  baseUrl?: string;
}

export interface AdminStorage {
  passwordHash?: string;
  salt?: string;
  providers: ProviderConfig[];
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    enabled: true,
    apiKey: process.env.GEMINI_API_KEY || '',
    model: 'gemini-2.5-flash',
    priority: 1,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek AI',
    enabled: false,
    apiKey: '',
    model: 'deepseek-chat',
    priority: 2,
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot AI)',
    enabled: false,
    apiKey: '',
    model: 'moonshot-v1-8k',
    priority: 3,
    baseUrl: 'https://api.moonshot.cn/v1',
  }
];

let adminStorage: AdminStorage = {
  providers: DEFAULT_PROVIDERS
};

// Active in-memory admin sessions
const activeAdminTokens = new Set<string>();

function loadAdminConfig(): void {
  try {
    if (fs.existsSync(ADMIN_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(ADMIN_CONFIG_FILE, 'utf-8'));
      if (data) {
        adminStorage = {
          passwordHash: data.passwordHash,
          salt: data.salt,
          providers: Array.isArray(data.providers) && data.providers.length > 0 
            ? data.providers 
            : DEFAULT_PROVIDERS
        };
        return;
      }
    }
  } catch (e) {
    console.error('Error loading admin config:', e);
  }
}

function saveAdminConfig(): void {
  try {
    fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify(adminStorage, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving admin config:', e);
  }
}

loadAdminConfig();

// Password hashing helpers
function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, actualSalt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt: actualSalt };
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  const check = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return check === hash;
}

// User persistent cached key helper
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
  } catch (e) {}
  cachedDiskApiKey = '';
  return '';
}
loadCachedDiskApiKey();

function saveCachedDiskApiKey(apiKey: string): void {
  try {
    if (!isValidApiKey(apiKey)) return;
    fs.writeFileSync(USER_KEY_FILE, JSON.stringify({ apiKey: apiKey.trim(), updatedAt: new Date().toISOString() }), 'utf-8');
    cachedDiskApiKey = apiKey.trim();
  } catch (e) {}
}

function removeCachedDiskApiKey(): void {
  try {
    if (fs.existsSync(USER_KEY_FILE)) fs.unlinkSync(USER_KEY_FILE);
    cachedDiskApiKey = '';
  } catch (e) {}
}

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

// =================================================================
// 3. EXPRESS APP INITIALIZATION & SECURITY
// =================================================================

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-gemini-api-key', 'x-admin-token', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Document storage
const uploadDir = path.join(os.tmpdir(), 'pdf-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// In-memory cache for extracted document text (for DeepSeek / Kimi / OpenAI models)
const documentTextCache = new Map<string, string>();

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/epub+zip',
  'application/x-mobipocket-ebook',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/rtf',
  'application/rtf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.epub',
  '.doc',
  '.docx',
  '.txt',
  '.md',
  '.csv',
  '.html',
  '.htm',
  '.rtf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp'
]);

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Desteklenmeyen dosya türü. PDF, EPUB, Word (.docx, .doc), Markdown, CSV ve Görseller kabul edilir.'));
    }
  }
});

// =================================================================
// 4. MULTI-MODEL CLIENTS & FAILOVER ENGINE
// =================================================================

const geminiClientCache = new Map<string, GoogleGenAI>();

function getGeminiClient(apiKey: string): GoogleGenAI {
  let client = geminiClientCache.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    geminiClientCache.set(apiKey, client);
  }
  return client;
}

/**
 * Parses EPUB into clean text and HTML
 */
function parseEpubFile(filePath: string): { text: string; html: string } {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();

    const htmlEntries = zipEntries
      .filter(entry => !entry.isDirectory && /\.(xhtml|html|htm)$/i.test(entry.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    let fullHtml = '';
    let fullText = '';

    for (const entry of htmlEntries) {
      const content = entry.getData().toString('utf-8');
      const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const chapterHtml = bodyMatch ? bodyMatch[1] : content;

      const chapterText = chapterHtml
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (chapterText.length > 0) {
        fullText += chapterText + '\n\n';
        fullHtml += `<div class="epub-chapter mb-8 pb-6 border-b border-white/10">\n${chapterHtml}\n</div>`;
      }
    }

    return {
      text: fullText.trim() || 'EPUB içeriği metne dönüştürülemedi.',
      html: fullHtml.trim() || '<p>EPUB içeriği görüntülenemedi.</p>'
    };
  } catch (e: any) {
    return {
      text: 'EPUB dosyası ayrıştırılırken hata oluştu: ' + e.message,
      html: '<p>EPUB ayrıştırma hatası.</p>'
    };
  }
}

/**
 * Returns list of active providers in priority order.
 * If user provided a client key in header or disk cache, Gemini is given first priority with that key.
 */
function getActiveProviderPool(req: Request): ProviderConfig[] {
  const customKey = (req.headers['x-gemini-api-key'] as string | undefined)?.trim();
  const validCustomKey = isValidApiKey(customKey) ? customKey : null;
  const validDiskKey = isValidApiKey(cachedDiskApiKey) ? cachedDiskApiKey : null;
  const validEnvKey = isValidApiKey(process.env.GEMINI_API_KEY) ? process.env.GEMINI_API_KEY?.trim() : null;

  const activeUserGeminiKey = validCustomKey || validDiskKey || validEnvKey;

  const pool: ProviderConfig[] = [];

  const sortedConfigured = [...adminStorage.providers]
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const p of sortedConfigured) {
    let effectiveKey = p.apiKey?.trim();
    if (p.id === 'gemini' && (!effectiveKey || !isValidApiKey(effectiveKey)) && activeUserGeminiKey) {
      effectiveKey = activeUserGeminiKey;
    }
    if (effectiveKey && isValidApiKey(effectiveKey)) {
      pool.push({
        ...p,
        apiKey: effectiveKey
      });
    }
  }

  // Fallback: If admin hasn't configured anything yet, but user entered a Gemini key
  if (pool.length === 0 && activeUserGeminiKey) {
    pool.push({
      id: 'gemini',
      name: 'Google Gemini',
      enabled: true,
      apiKey: activeUserGeminiKey,
      model: 'gemini-2.5-flash',
      priority: 1
    });
  }

  return pool;
}

/**
 * Stream caller for OpenAI-compatible providers (DeepSeek, Kimi/Moonshot)
 */
async function* streamOpenAICompatible(
  provider: ProviderConfig,
  systemInstruction: string,
  messages: Array<{ role: string; content: string }>
): AsyncGenerator<string, void, unknown> {
  const baseUrl = provider.baseUrl || (provider.id === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.moonshot.cn/v1');
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const payloadMessages = [
    { role: 'system', content: systemInstruction },
    ...messages
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages: payloadMessages,
      stream: true,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let parsed: any = {};
    try { parsed = JSON.parse(errorText); } catch {}
    const errMsg = parsed?.error?.message || parsed?.message || errorText || `HTTP ${response.status}`;
    const err: any = new Error(errMsg);
    err.status = response.status;
    throw err;
  }

  if (!response.body) throw new Error('Yanıt akışı başlatılamadı');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') return;

      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch (e) {}
      }
    }
  }
}

/**
 * Stream caller for Google Gemini
 */
async function* streamGemini(
  provider: ProviderConfig,
  systemInstruction: string,
  messages: Array<{ role: string; text: string }>,
  fileUri?: string,
  mimeType?: string
): AsyncGenerator<string, void, unknown> {
  const aiClient = getGeminiClient(provider.apiKey);

  const chatContents = messages.map(m => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: m.text }]
  }));

  const contents: any[] = [];
  if (fileUri) {
    contents.push({
      role: 'user',
      parts: [{ fileData: { fileUri, mimeType: mimeType || 'application/pdf' } }]
    });
  }
  contents.push(...chatContents);

  const responseStream = await aiClient.models.generateContentStream({
    model: provider.model || 'gemini-2.5-flash',
    contents,
    config: {
      systemInstruction,
      temperature: 0.2
    }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) yield chunk.text;
  }
}

// =================================================================
// 5. PUBLIC & GENERAL API ROUTES
// =================================================================

app.get('/api/config', (req: Request, res: Response) => {
  const hasEnvKey = isValidApiKey(process.env.GEMINI_API_KEY);
  const hasDiskKey = isValidApiKey(cachedDiskApiKey);
  const activeKey = hasDiskKey ? cachedDiskApiKey : (hasEnvKey ? (process.env.GEMINI_API_KEY || '') : '');
  
  const enabledCount = adminStorage.providers.filter(p => p.enabled && isValidApiKey(p.apiKey)).length;

  res.json({
    hasServerApiKey: hasEnvKey,
    hasCachedDiskKey: hasDiskKey,
    hasAnyValidKey: Boolean(activeKey) || enabledCount > 0,
    cachedKeyMasked: activeKey ? maskApiKey(activeKey) : '',
    cachedKey: hasDiskKey ? cachedDiskApiKey : '',
    activeProvidersCount: enabledCount,
    maxUploadSizeMB: 50
  });
});

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

app.post('/api/key/remove', (req: Request, res: Response) => {
  removeCachedDiskApiKey();
  res.json({
    success: true,
    message: 'Kaydedilmiş API anahtarı başarıyla kaldırıldı.'
  });
});

// =================================================================
// 6. ADMIN API ROUTES
// =================================================================

app.get('/api/admin/status', (req: Request, res: Response) => {
  const token = req.headers['x-admin-token'] as string | undefined;
  const isSetup = Boolean(adminStorage.passwordHash && adminStorage.salt);
  const isAuthenticated = Boolean(token && activeAdminTokens.has(token));

  res.json({
    isSetup,
    isAuthenticated
  });
});

app.post('/api/admin/setup', (req: Request, res: Response) => {
  if (adminStorage.passwordHash && adminStorage.salt) {
    return res.status(400).json({ error: 'Admin şifresi zaten tanımlanmış. Lütfen giriş yapın.' });
  }

  const { password } = req.body;
  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır.' });
  }

  const { hash, salt } = hashPassword(password);
  adminStorage.passwordHash = hash;
  adminStorage.salt = salt;
  saveAdminConfig();

  const token = crypto.randomBytes(32).toString('hex');
  activeAdminTokens.add(token);

  res.json({
    success: true,
    token,
    message: 'Yönetici şifresi başarıyla oluşturuldu.'
  });
});

app.post('/api/admin/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (!adminStorage.passwordHash || !adminStorage.salt) {
    return res.status(400).json({ error: 'Admin şifresi henüz ayarlanmamış.' });
  }

  if (!password || !verifyPassword(password, adminStorage.passwordHash, adminStorage.salt)) {
    return res.status(401).json({ error: 'Hatalı yönetici şifresi.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  activeAdminTokens.add(token);

  res.json({
    success: true,
    token,
    message: 'Giriş başarılı.'
  });
});

// Middleware for protected admin routes
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!token || !activeAdminTokens.has(token)) {
    return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen admin girişi yapın.' });
  }
  next();
}

app.get('/api/admin/providers', requireAdminAuth, (req: Request, res: Response) => {
  res.json({
    providers: adminStorage.providers.map(p => ({
      ...p,
      apiKey: p.apiKey ? p.apiKey : ''
    }))
  });
});

app.post('/api/admin/providers', requireAdminAuth, (req: Request, res: Response) => {
  const { providers } = req.body;
  if (!Array.isArray(providers)) {
    return res.status(400).json({ error: 'Geçersiz sağlayıcı listesi.' });
  }

  adminStorage.providers = providers.map((p, idx) => ({
    id: p.id,
    name: p.name,
    enabled: Boolean(p.enabled),
    apiKey: typeof p.apiKey === 'string' ? p.apiKey.trim() : '',
    model: p.model || '',
    priority: idx + 1,
    baseUrl: p.baseUrl
  }));

  saveAdminConfig();

  res.json({
    success: true,
    message: 'Yapay zeka modelleri ve öncelik havuzu kaydedildi.'
  });
});

app.post('/api/admin/test-provider', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { providerId, apiKey, model, baseUrl } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({ error: 'Lütfen test etmek için bir API anahtarı girin.' });
    }

    const cleanKey = apiKey.trim();

    if (providerId === 'gemini') {
      const client = getGeminiClient(cleanKey);
      // Clean model name or default to gemini-2.5-flash
      let targetModel = model || 'gemini-2.5-flash';
      if (targetModel.includes('1.5-pro') || targetModel === 'models/gemini-1.5-pro') {
        targetModel = 'gemini-2.5-flash';
      }

      try {
        const result = await client.models.generateContent({
          model: targetModel,
          contents: 'Ping',
        });
        if (result) {
          return res.json({ success: true, message: `Google Gemini (${targetModel}) bağlantısı başarılı!` });
        }
      } catch (geminiTestErr: any) {
        // Fallback test with gemini-2.5-flash if selected model failed
        if (targetModel !== 'gemini-2.5-flash') {
          const fallbackResult = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Ping',
          });
          if (fallbackResult) {
            return res.json({ success: true, message: `Gemini 2.5 Flash ile bağlantı başarılı!` });
          }
        }
        throw geminiTestErr;
      }
    } else {
      const testProvider: ProviderConfig = {
        id: providerId,
        name: providerId,
        enabled: true,
        apiKey: cleanKey,
        model: model || (providerId === 'deepseek' ? 'deepseek-chat' : 'moonshot-v1-8k'),
        priority: 1,
        baseUrl
      };

      const generator = streamOpenAICompatible(testProvider, 'Test asistanı.', [{ role: 'user', content: 'Ping' }]);
      let text = '';
      for await (const chunk of generator) {
        text += chunk;
        if (text.length > 0) break;
      }
      return res.json({ success: true, message: `${providerId.toUpperCase()} (${testProvider.model}) bağlantısı başarılı!` });
    }

    res.status(400).json({ error: 'Yanıt alınamadı.' });
  } catch (error: any) {
    const errStr = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
    
    if (errStr.includes('Insufficient Balance') || errStr.includes('balance') || error.status === 402) {
      return res.status(400).json({ 
        error: 'Bakiye Yetersiz (Insufficient Balance): API anahtarınız geçerli fakat hesabınızda kredi/bakiye bulunmuyor.' 
      });
    }
    if (errStr.includes('Invalid Authentication') || errStr.includes('invalid_api_key') || errStr.includes('API key not valid') || error.status === 401) {
      return res.status(400).json({ 
        error: 'Geçersiz API Anahtarı (401): Lütfen API anahtarınızı ve kopyalarken başında/sonunda boşluk olmadığını kontrol edin.' 
      });
    }
    if (errStr.includes('not found') || errStr.includes('NOT_FOUND') || error.status === 404) {
      return res.status(400).json({ 
        error: 'Model Bulunamadı (404): Lütfen Gemini için "gemini-2.5-flash" modelini seçin.' 
      });
    }

    res.status(400).json({ error: error.message || 'Bağlantı testi başarısız oldu.' });
  }
});

// =================================================================
// 7. DOCUMENT UPLOAD & PARSING
// =================================================================

app.post('/api/parse-document', upload.single('file'), async (req: Request, res: Response) => {
  const uploadedPath = req.file?.path;
  try {
    if (!req.file || !uploadedPath) {
      return res.status(400).json({ error: 'Dosya bulunamadı.' });
    }

    const lowerName = req.file.originalname.toLowerCase();
    const mimeType = req.file.mimetype;
    let extractedText = '';
    let extractedHtml = '';

    if (mimeType === 'application/epub+zip' || lowerName.endsWith('.epub')) {
      const epubData = parseEpubFile(uploadedPath);
      extractedText = epubData.text;
      extractedHtml = epubData.html;
    } else if (mimeType === 'application/msword' || lowerName.endsWith('.doc')) {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(uploadedPath);
      extractedText = extracted.getBody();
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
      const htmlResult = await mammoth.convertToHtml({ path: uploadedPath });
      extractedHtml = htmlResult.value;
      const result = await mammoth.extractRawText({ path: uploadedPath });
      extractedText = result.value;
    }

    // Cache extracted text in memory
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (extractedText) {
      documentTextCache.set(docId, extractedText);
    }

    res.json({
      success: true,
      docId,
      displayName: req.file.originalname,
      mimeType: req.file.mimetype,
      extractedText,
      extractedHtml
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Belge ayrıştırılamadı: ' + (e.message || 'Bilinmeyen hata') });
  } finally {
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      try { fs.unlinkSync(uploadedPath); } catch {}
    }
  }
});

app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
  const uploadedPath = req.file?.path;
  let tempConvertedPath: string | null = null;

  try {
    if (!req.file || !uploadedPath) {
      return res.status(400).json({ error: 'Yüklenecek dosya bulunamadı.' });
    }

    const pool = getActiveProviderPool(req);
    const geminiProvider = pool.find(p => p.id === 'gemini');

    let filePath = uploadedPath;
    let mimeType = req.file.mimetype;
    let extractedText: string | null = null;
    let extractedHtml: string | null = null;

    const lowerName = req.file.originalname.toLowerCase();

    // 1. Handle EPUB files
    if (mimeType === 'application/epub+zip' || lowerName.endsWith('.epub')) {
      const epubData = parseEpubFile(uploadedPath);
      extractedText = epubData.text;
      extractedHtml = epubData.html;
      tempConvertedPath = uploadedPath + '.txt';
      fs.writeFileSync(tempConvertedPath, extractedText, 'utf-8');
      filePath = tempConvertedPath;
      mimeType = 'text/plain';
    }
    // 2. Handle .doc
    else if (mimeType === 'application/msword' || lowerName.endsWith('.doc')) {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(uploadedPath);
      extractedText = extracted.getBody();
      tempConvertedPath = uploadedPath + '.txt';
      fs.writeFileSync(tempConvertedPath, extractedText, 'utf-8');
      filePath = tempConvertedPath;
      mimeType = 'text/plain';
    }
    // 3. Handle .docx
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
      const htmlResult = await mammoth.convertToHtml({ path: uploadedPath });
      extractedHtml = htmlResult.value;
      const result = await mammoth.extractRawText({ path: uploadedPath });
      extractedText = result.value;
      tempConvertedPath = uploadedPath + '.txt';
      fs.writeFileSync(tempConvertedPath, extractedText, 'utf-8');
      filePath = tempConvertedPath;
      mimeType = 'text/plain';
    }

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (extractedText) {
      documentTextCache.set(docId, extractedText);
    }

    let uploadResult: any = null;

    // If a valid Gemini provider exists, upload to Gemini File API
    if (geminiProvider && isValidApiKey(geminiProvider.apiKey)) {
      try {
        const aiClient = getGeminiClient(geminiProvider.apiKey);
        const safeDisplayName = path.basename(req.file.originalname).slice(0, 120);

        uploadResult = await aiClient.files.upload({
          file: filePath,
          config: {
            mimeType: mimeType,
            displayName: safeDisplayName,
          }
        });

        let fileState = await aiClient.files.get({ name: uploadResult.name });
        let attempts = 0;
        while (fileState.state === 'PROCESSING' && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          fileState = await aiClient.files.get({ name: uploadResult.name });
          attempts++;
        }
      } catch (geminiErr) {
        console.warn('Gemini File upload warning (will fallback to text cache for other models):', geminiErr);
      }
    }

    res.json({
      docId,
      name: uploadResult?.name || docId,
      uri: uploadResult?.uri || docId,
      mimeType: mimeType,
      displayName: req.file.originalname,
      extractedText,
      extractedHtml
    });
  } catch (error: any) {
    console.error('Upload Error:', error);
    res.status(500).json({
      error: 'UPLOAD_FAILED',
      message: 'Belge yüklenirken bir hata oluştu: ' + (error.message || 'Bilinmeyen hata')
    });
  } finally {
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      try { fs.unlinkSync(uploadedPath); } catch {}
    }
    if (tempConvertedPath && fs.existsSync(tempConvertedPath)) {
      try { fs.unlinkSync(tempConvertedPath); } catch {}
    }
  }
});

// =================================================================
// 8. CHAT & ACTIONS WITH AUTO-FAILOVER ENGINE
// =================================================================

const SYSTEM_INSTRUCTION = `
Sen PDF & Doküman Asistanısın. Sana sağlanan belgeye dayanarak kullanıcının sorularını yanıtla.
Kullanıcıya her zaman dostça, açık ve profesyonel bir dille (Türkçe) hitap et.
Eğer belge bir PDF ise, yanıtlarında belgeden referans verirken ilgili sayfa numarasını [Sayfa X] (örneğin [Sayfa 5], [Sayfa 12]) formatında belirt.
Eğer aradıkları bilgi belgede yoksa, bunu kibarca belirt ve tahmin yürütme.
`.trim();

app.post('/api/chat', async (req: Request, res: Response) => {
  const pool = getActiveProviderPool(req);

  if (pool.length === 0) {
    return res.status(401).json({
      error: 'GEMINI_API_KEY_REQUIRED',
      message: 'Sohbeti başlatmak için lütfen geçerli bir API anahtarı tanımlayın.'
    });
  }

  const { documentUri, docId, mimeType = 'application/pdf', messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Mesaj listesi boş olamaz.' });
  }

  // Find document text in cache for non-Gemini models (DeepSeek, Kimi)
  const cachedText = (docId && documentTextCache.get(docId)) || (documentUri && documentTextCache.get(documentUri)) || '';

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  let success = false;
  let lastError: any = null;

  for (let i = 0; i < pool.length; i++) {
    const provider = pool[i];
    console.log(`[AI POOL] Attempting response with provider #${i + 1}: ${provider.name} (${provider.model})`);

    try {
      if (provider.id === 'gemini') {
        const isGeminiUri = documentUri && documentUri.startsWith('https://generativelanguage.googleapis.com');
        const fileUriToUse = isGeminiUri ? documentUri : undefined;

        // If no Gemini URI, inject document text into system instruction
        let promptSystemInstruction = SYSTEM_INSTRUCTION;
        if (!fileUriToUse && cachedText) {
          promptSystemInstruction += `\n\n[BELGE İÇERİĞİ]:\n${cachedText.slice(0, 100000)}`;
        }

        const generator = streamGemini(
          provider,
          promptSystemInstruction,
          messages.map((m: any) => ({ role: m.role, text: String(m.text || '') })),
          fileUriToUse,
          mimeType
        );

        for await (const chunk of generator) {
          res.write(chunk);
        }
        success = true;
        break;
      } else {
        // DeepSeek or Kimi/Moonshot
        let promptSystemInstruction = SYSTEM_INSTRUCTION;
        if (cachedText) {
          promptSystemInstruction += `\n\n[DOKÜMAN İÇERİĞİ]:\n${cachedText.slice(0, 100000)}`;
        }

        const openAiMessages = messages.map((m: any) => ({
          role: m.role === 'model' ? 'assistant' : 'user',
          content: String(m.text || '')
        }));

        const generator = streamOpenAICompatible(
          provider,
          promptSystemInstruction,
          openAiMessages
        );

        for await (const chunk of generator) {
          res.write(chunk);
        }
        success = true;
        break;
      }
    } catch (err: any) {
      console.warn(`[AI FAILOVER] Provider ${provider.name} failed:`, err.message || err);
      lastError = err;
      // If there is a next provider, notify stream with a failover note if desired
      if (i < pool.length - 1) {
        console.log(`[AI FAILOVER] Falling over to next provider: ${pool[i + 1].name}...`);
      }
    }
  }

  if (!success) {
    const errorMsg = `\n\n⚠️ Üzgünüm, aktif tüm yapay zeka modelleri (${pool.map(p => p.name).join(', ')}) hata verdi: ${lastError?.message || 'Kota veya bağlantı sorunu.'}`;
    res.write(errorMsg);
  }

  res.end();
});

app.post('/api/action', async (req: Request, res: Response) => {
  const pool = getActiveProviderPool(req);

  if (pool.length === 0) {
    return res.status(401).json({
      error: 'GEMINI_API_KEY_REQUIRED',
      message: 'İşlem için geçerli bir API anahtarı tanımlanmalıdır.'
    });
  }

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

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  let success = false;
  let lastError: any = null;

  for (let i = 0; i < pool.length; i++) {
    const provider = pool[i];
    try {
      if (provider.id === 'gemini') {
        const generator = streamGemini(
          provider,
          'Sen profesyonel bir metin asistanısın.',
          [{ role: 'user', text: `${prompt}\n\nMetin:\n${safeText}` }]
        );
        for await (const chunk of generator) {
          res.write(chunk);
        }
        success = true;
        break;
      } else {
        const generator = streamOpenAICompatible(
          provider,
          'Sen profesyonel bir metin asistanısın.',
          [{ role: 'user', content: `${prompt}\n\nMetin:\n${safeText}` }]
        );
        for await (const chunk of generator) {
          res.write(chunk);
        }
        success = true;
        break;
      }
    } catch (err: any) {
      console.warn(`[ACTION FAILOVER] ${provider.name} failed:`, err.message);
      lastError = err;
    }
  }

  if (!success) {
    res.write(`\n\n⚠️ İşlem gerçekleştirilemedi: ${lastError?.message || 'Hata oluştu'}`);
  }

  res.end();
});

// =================================================================
// 9. SERVER STARTUP & STATIC HOSTING
// =================================================================

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
      console.log(`🔒 Secure Admin Gateway & Multi-Model Pool Ready`);
      console.log(`🤖 Providers: Gemini, DeepSeek, Kimi/Moonshot`);
      console.log(`========================================\n`);

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

startServer();

const STORAGE_KEY = 'pdf_assistant_gemini_api_key';

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

export function getStoredApiKey(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim() || '';
    if (isValidApiKey(raw)) {
      return raw;
    }
    // Clean up if invalid placeholder was previously in storage
    if (raw) {
      localStorage.removeItem(STORAGE_KEY);
    }
    return '';
  } catch {
    return '';
  }
}

export async function setStoredApiKey(key: string, persistOnDisk: boolean = true): Promise<void> {
  const trimmed = key.trim();
  if (!isValidApiKey(trimmed)) {
    throw new Error('Geçersiz Gemini API anahtarı. Lütfen geçerli bir anahtar girin (Örn: AIzaSy...).');
  }

  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch (e) {
    console.error('LocalStorage write error:', e);
  }

  // Persist to local machine cache via backend
  if (persistOnDisk) {
    try {
      await fetch('/api/key/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed })
      });
    } catch (e) {
      console.warn('Backend persistent cache save error:', e);
    }
  }

  window.dispatchEvent(new Event('gemini_api_key_changed'));
}

export async function removeStoredApiKey(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('LocalStorage remove error:', e);
  }

  // Remove from local machine cache via backend
  try {
    await fetch('/api/key/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.warn('Backend persistent cache remove error:', e);
  }

  window.dispatchEvent(new Event('gemini_api_key_changed'));
}

export function getApiHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const key = getStoredApiKey();
  const headers: Record<string, string> = { ...customHeaders };
  if (isValidApiKey(key)) {
    headers['x-gemini-api-key'] = key;
  }
  return headers;
}

/**
 * Synchronizes API keys between browser localStorage and backend disk cache
 */
export async function syncApiKeyWithBackend(): Promise<string> {
  let localKey = getStoredApiKey();
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    
    // If backend has a cached valid key on disk and frontend doesn't, hydrate frontend
    if (!localKey && isValidApiKey(data.cachedKey)) {
      localKey = data.cachedKey;
      localStorage.setItem(STORAGE_KEY, localKey);
      window.dispatchEvent(new Event('gemini_api_key_changed'));
    } 
    // If frontend has a valid key and backend doesn't, persist it to disk
    else if (isValidApiKey(localKey) && !data.hasCachedDiskKey) {
      await fetch('/api/key/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: localKey })
      });
    }
  } catch (e) {
    console.warn('API key sync error:', e);
  }
  return localKey;
}

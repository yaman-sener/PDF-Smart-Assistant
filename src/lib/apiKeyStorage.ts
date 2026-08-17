const STORAGE_KEY = 'pdf_assistant_gemini_api_key';

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export async function setStoredApiKey(key: string, persistOnDisk: boolean = true): Promise<void> {
  const trimmed = key.trim();
  try {
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.error('LocalStorage write error:', e);
  }

  // Persist to local machine cache via backend
  if (persistOnDisk && trimmed) {
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
  if (key) {
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
    
    // If backend has a cached key on disk and frontend doesn't, hydrate frontend
    if (!localKey && data.cachedKey) {
      localKey = data.cachedKey;
      localStorage.setItem(STORAGE_KEY, localKey);
      window.dispatchEvent(new Event('gemini_api_key_changed'));
    } 
    // If frontend has a key and backend doesn't, persist it to disk
    else if (localKey && !data.hasCachedDiskKey) {
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

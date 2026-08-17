const STORAGE_KEY = 'pdf_assistant_gemini_api_key';

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function setStoredApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new Event('gemini_api_key_changed'));
  } catch (e) {
    console.error('LocalStorage write error:', e);
  }
}

export function removeStoredApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('gemini_api_key_changed'));
  } catch (e) {
    console.error('LocalStorage remove error:', e);
  }
}

export function getApiHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const key = getStoredApiKey();
  const headers: Record<string, string> = { ...customHeaders };
  if (key) {
    headers['x-gemini-api-key'] = key;
  }
  return headers;
}

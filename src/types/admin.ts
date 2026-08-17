export type ProviderType = 'gemini' | 'deepseek' | 'kimi';

export interface ProviderConfig {
  id: ProviderType;
  name: string;
  enabled: boolean;
  apiKey: string;
  model: string;
  priority: number;
  baseUrl?: string;
}

export interface AdminConfig {
  isSetup: boolean;
  providers: ProviderConfig[];
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
  provider: ProviderType;
  model: string;
  latencyMs?: number;
}

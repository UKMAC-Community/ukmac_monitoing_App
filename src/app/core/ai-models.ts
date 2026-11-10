export type AiProvider = 'openrouter' | 'local';

/** Metadata only: a saved key never comes back from the native backend. */
export interface AiStatus {
  configured: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}
export interface AiConnectionInput {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  /** Null preserves a saved key only for the same provider and endpoint. */
  apiKey: string | null;
}
export interface AiVisualInput {
  requestId: string;
  prompt: string;
  columns: { key: string; name: string; kind: 'number' | 'date' | 'text' }[];
  rowCount: number;
  allowedTypes: string[];
}
export interface AiConnectionTest { message: string; modelAvailable: boolean; }

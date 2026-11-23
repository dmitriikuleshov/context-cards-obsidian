import { endpoint, jsonRequest } from './http';
import type { Settings } from './types';

export interface ModelMessage {
  role: string;
  content: string;
}
export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  format: object;
  [key: string]: unknown;
}
export interface SubscriptionModel {
  id: string;
  name: string;
}
export interface SubscriptionConnection {
  models(signal?: AbortSignal, account?: string): Promise<SubscriptionModel[]>;
  chat(
    body: ModelRequest,
    settings: Settings,
    signal?: AbortSignal,
    timeout?: number,
  ): Promise<unknown>;
}
export function requireSubscription(connection?: SubscriptionConnection): SubscriptionConnection {
  if (!connection) throw new Error('Connect ChatGPT in Context Cards settings before generating.');
  return connection;
}
/** Keep the existing prompts and validators; adapt only the selected transport. */
export function modelChat<T>(
  settings: Settings,
  body: ModelRequest,
  signal?: AbortSignal,
  timeout = settings.timeoutSeconds * 1000,
  connection?: SubscriptionConnection,
): Promise<T> {
  if (settings.provider === 'chatgpt')
    return requireSubscription(connection).chat(body, settings, signal, timeout) as Promise<T>;
  return jsonRequest<T>(`${endpoint(settings.ollamaUrl)}/api/chat`, body, signal, timeout);
}

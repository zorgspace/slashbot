/**
 * Provider Types - Interfaces for multi-provider LLM support
 */

export interface ProviderInfo {
  id: string;
  name: string;
  envVars: string[];
  defaultModel: string;
  defaultImageModel?: string;
  baseUrl?: string;
  capabilities: ProviderCapabilities;
}

export interface ProviderCapabilities {
  vision: boolean;
  reasoning: boolean;
  streaming: boolean;
  maxTokens: number;
  /** Maximum output tokens the provider supports (fallback if model-specific value is absent) */
  maxOutputTokens: number;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  maxTokens: number;
  /** Maximum output tokens this model supports */
  maxOutputTokens: number;
  vision: boolean;
  reasoning: boolean;
  /** Whether the model supports native tool calling (default: true) */
  toolCalling?: boolean;
}

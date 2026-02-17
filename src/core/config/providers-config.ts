/**
 * @module providers-config
 *
 * Defines the Zod schema for the user-level providers configuration file
 * (`~/.slashbot/providers.json`) and provides a loader to read and validate it.
 * This file allows users to declare custom LLM providers and override model
 * configurations for built-in providers.
 *
 * Key exports:
 * - {@link loadProvidersConfig} - Reads and validates the providers config file
 * - {@link ProviderModelConfig} - Type for a single model entry within a provider
 * - {@link ProviderConfigEntry} - Type for a single provider entry
 * - {@link ProvidersFileConfig} - Top-level type for the providers.json file
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema for ~/.slashbot/providers.json
// ---------------------------------------------------------------------------

const ProviderModelConfigSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  contextWindow: z.number().int().positive(),
  priority: z.number().int().optional(),
  capabilities: z.array(z.string()).optional(),
});

const ProviderConfigEntrySchema = z.object({
  displayName: z.string().optional(),
  type: z.enum(['openai-compatible']).optional(),
  baseUrl: z.string().optional(),
  config: z.object({
    temperature: z.number().optional(),
    maxTokens: z.number().int().optional(),
    contextLimit: z.number().int().optional(),
  }).optional(),
  models: z.array(ProviderModelConfigSchema).optional(),
});

const ProvidersFileConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigEntrySchema),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Configuration for a single model within a provider (id, display name, context window, etc.). */
export type ProviderModelConfig = z.infer<typeof ProviderModelConfigSchema>;
/** Configuration entry for a single LLM provider (display name, base URL, models, etc.). */
export type ProviderConfigEntry = z.infer<typeof ProviderConfigEntrySchema>;
/** Top-level structure of the providers.json configuration file. */
export type ProvidersFileConfig = z.infer<typeof ProvidersFileConfigSchema>;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Reads and validates the providers configuration file from disk.
 *
 * @param path - Optional file path override; defaults to ~/.slashbot/providers.json.
 * @returns The parsed and validated config, or `undefined` if the file does not exist.
 * @throws If the file exists but contains invalid JSON or fails schema validation.
 */
export async function loadProvidersConfig(
  path?: string,
): Promise<ProvidersFileConfig | undefined> {
  const filePath = path ?? join(homedir(), '.slashbot', 'providers.json');

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  return ProvidersFileConfigSchema.parse(parsed);
}

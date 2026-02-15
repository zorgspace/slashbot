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

export type ProviderModelConfig = z.infer<typeof ProviderModelConfigSchema>;
export type ProviderConfigEntry = z.infer<typeof ProviderConfigEntrySchema>;
export type ProvidersFileConfig = z.infer<typeof ProvidersFileConfigSchema>;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

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

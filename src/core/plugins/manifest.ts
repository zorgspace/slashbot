import { z } from 'zod';
import type { PluginManifest } from '../kernel/contracts.js';

const PluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  main: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().optional(),
  dependencies: z.array(z.string()).optional(),
  configSchema: z.record(z.string(), z.unknown()).optional(),
}).strict();

export function validateManifest(value: unknown): PluginManifest {
  return PluginManifestSchema.parse(value) as PluginManifest;
}

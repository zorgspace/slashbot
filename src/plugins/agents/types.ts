import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AgentSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  role: z.string().default(''),
  systemPrompt: z.string().default(''),
  provider: z.string().optional(),
  model: z.string().optional(),
  enabled: z.boolean().default(true),
  toolAllowlist: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export interface AgentSpec {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider?: string;
  model?: string;
  enabled: boolean;
  toolAllowlist?: string[];
  createdAt: string;
  updatedAt: string;
}

export const TeamSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  leaderAgentId: z.string(),
  memberAgentIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export interface TeamSpec {
  id: string;
  name: string;
  leaderAgentId: string;
  memberAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

import type { SkillsConfig } from './types.js';

/** Resolve an env var: process.env first, then per-skill config fallback. */
export function resolveEnvVar(
  envVar: string,
  skillName: string,
  config: SkillsConfig,
): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;

  return config.entries[skillName]?.env?.[envVar];
}

/** Build merged env for a skill: process.env overridden by per-skill config values. */
export function buildSkillEnv(
  skillName: string,
  config: SkillsConfig,
): Record<string, string | undefined> {
  const overrides = config.entries[skillName]?.env;
  if (!overrides) return {};

  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    // Only include config values that aren't already in process.env
    if (!process.env[key]) {
      result[key] = value;
    }
  }
  return result;
}

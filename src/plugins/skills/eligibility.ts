import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { resolveEnvVar } from './env-overrides.js';
import type { PrerequisiteResult, SkillEntry, SkillsConfig, SlashbotMetadata } from './types.js';

const execFileAsync = promisify(execFile);

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Full prerequisite check: OS, bins, anyBins, env (with config fallback). */
export async function checkPrerequisites(
  metadata: SlashbotMetadata | undefined,
  skillName: string,
  config: SkillsConfig,
): Promise<PrerequisiteResult> {
  const result: PrerequisiteResult = {
    ok: true,
    missingBins: [],
    missingAnyBins: [],
    missingEnv: [],
    osMatch: true,
    hints: [],
  };

  if (!metadata) return result;

  // OS check
  if (metadata.os && metadata.os.length > 0) {
    const current = platform();
    const mapped = mapPlatformToOs(current);
    if (!metadata.os.some((os) => mapped.includes(os))) {
      result.osMatch = false;
      result.ok = false;
      result.hints.push(`Requires OS: ${metadata.os.join(', ')} (current: ${current})`);
    }
  }

  const requires = metadata.requires;
  if (!requires) return result;

  // bins: all must exist
  if (requires.bins) {
    for (const bin of requires.bins) {
      if (!(await commandExists(bin))) {
        result.missingBins.push(bin);
        result.hints.push(`Install '${bin}' (e.g., apt install ${bin} / brew install ${bin})`);
      }
    }
  }

  // anyBins: at least one must exist
  if (requires.anyBins && requires.anyBins.length > 0) {
    let foundAny = false;
    for (const bin of requires.anyBins) {
      if (await commandExists(bin)) {
        foundAny = true;
        break;
      }
    }
    if (!foundAny) {
      result.missingAnyBins = requires.anyBins;
      result.hints.push(`Install one of: ${requires.anyBins.join(', ')}`);
    }
  }

  // env: check process.env then config fallback
  if (requires.env) {
    for (const envVar of requires.env) {
      if (!resolveEnvVar(envVar, skillName, config)) {
        result.missingEnv.push(envVar);
        result.hints.push(`Set environment variable: export ${envVar}=...`);
      }
    }
  }

  result.ok =
    result.osMatch &&
    result.missingBins.length === 0 &&
    result.missingAnyBins.length === 0 &&
    result.missingEnv.length === 0;

  return result;
}

/** Check if a bundled skill passes the allowlist filter. */
export function isBundledAllowed(name: string, config: SkillsConfig): boolean {
  if (!config.bundledAllowlist) return true;
  return config.bundledAllowlist.includes(name);
}

/** Check if a skill is explicitly disabled in config. */
export function isSkillDisabled(name: string, config: SkillsConfig): boolean {
  return config.entries[name]?.enabled === false;
}

/** Master gate: should this skill be included in the eligible list? */
export async function shouldIncludeSkill(
  entry: SkillEntry,
  config: SkillsConfig,
): Promise<{ included: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  if (isSkillDisabled(entry.name, config)) {
    reasons.push('Disabled in config');
    return { included: false, reasons };
  }

  if (entry.source === 'bundled' && !config.allowBundled) {
    reasons.push('Bundled skills disabled');
    return { included: false, reasons };
  }

  if (entry.source === 'bundled' && !isBundledAllowed(entry.name, config)) {
    reasons.push('Not in bundled allowlist');
    return { included: false, reasons };
  }

  const prereqs = await checkPrerequisites(entry.frontmatter.slashbot, entry.name, config);
  if (!prereqs.ok) {
    reasons.push(...prereqs.hints);
    return { included: false, reasons };
  }

  return { included: true, reasons };
}

// ── Helpers ──

function mapPlatformToOs(p: NodeJS.Platform): string[] {
  switch (p) {
    case 'darwin':
      return ['macos', 'darwin'];
    case 'linux':
      return ['linux'];
    case 'win32':
      return ['windows', 'win32'];
    default:
      return [p];
  }
}

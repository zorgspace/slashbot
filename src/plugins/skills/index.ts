import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { JsonValue, SlashbotPlugin } from '@slashbot/plugin-sdk';
import { asObject, asString } from '../utils.js';

const PLUGIN_ID = 'slashbot.skills';
const execFileAsync = promisify(execFile);

interface SkillPrerequisites {
  bins?: string[];
  env?: string[];
}

interface PrerequisiteCheckResult {
  ok: boolean;
  missingBins: string[];
  missingEnv: string[];
  hints: string[];
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    // Parse simple YAML arrays: [a, b, c] or comma-separated
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      result[key] = rawValue.slice(1, -1).split(',').map((v) => v.trim()).filter((v) => v.length > 0);
    } else {
      result[key] = rawValue;
    }
  }

  return result;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
}

function parsePrerequisites(content: string): SkillPrerequisites {
  const frontmatter = parseFrontmatter(content);
  const requires = frontmatter.requires as Record<string, unknown> | undefined;
  if (!requires || typeof requires !== 'object') {
    // Try flat keys: requires.bins, requires.env
    const bins = frontmatter['requires.bins'];
    const env = frontmatter['requires.env'];
    return {
      bins: Array.isArray(bins) ? bins.filter((b): b is string => typeof b === 'string') : undefined,
      env: Array.isArray(env) ? env.filter((e): e is string => typeof e === 'string') : undefined,
    };
  }
  return {
    bins: Array.isArray(requires.bins) ? requires.bins.filter((b): b is string => typeof b === 'string') : undefined,
    env: Array.isArray(requires.env) ? requires.env.filter((e): e is string => typeof e === 'string') : undefined,
  };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

interface Skill {
  name: string;
  path: string;
  content: string;
  ruleFiles: string[];
  source: 'workspace' | 'global';
}

/**
 * SkillManager — discovers, loads, and validates SKILL.md modules.
 *
 * Skills are directories containing a SKILL.md (or skill.md) file with optional
 * frontmatter prerequisites (required binaries and env vars) and additional rule
 * files (*.md). Skills live in ~/.skills/ (global). Workspace-local overrides
 * in .slashbot/skills/ take priority over global ones with the same name.
 */
class SkillManager {
  private readonly workspaceSkillsDir: string;
  private readonly homeSkillsDir: string;

  constructor(workspaceRoot: string, homeSkillsDir: string) {
    this.workspaceSkillsDir = join(workspaceRoot, '.slashbot', 'skills');
    this.homeSkillsDir = homeSkillsDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.homeSkillsDir, { recursive: true });
  }

  private async listSkillNamesFrom(baseDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      const names: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(baseDir, entry.name);
        const mainFile = await this.resolveMainFile(skillPath);
        if (mainFile) {
          names.push(entry.name);
        }
      }
      return names;
    } catch {
      return [];
    }
  }

  async listSkills(): Promise<string[]> {
    const [workspaceSkills, bundledSkills] = await Promise.all([
      this.listSkillNamesFrom(this.workspaceSkillsDir),
      this.listSkillNamesFrom(this.homeSkillsDir),
    ]);

    return [...new Set([...workspaceSkills, ...bundledSkills])].sort((a, b) => a.localeCompare(b));
  }

  private async resolveMainFile(skillPath: string): Promise<string | null> {
    const candidates = [join(skillPath, 'SKILL.md'), join(skillPath, 'skill.md')];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue.
      }
    }
    return null;
  }

  private async collectRuleFiles(skillPath: string, mainFile: string): Promise<string[]> {
    const rules: string[] = [];
    const mainRel = relative(skillPath, mainFile).replace(/\\/g, '/').toLowerCase();

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (!entry.name.toLowerCase().endsWith('.md')) {
          continue;
        }
        const rel = relative(skillPath, fullPath).replace(/\\/g, '/');
        if (rel.toLowerCase() === mainRel) {
          continue;
        }
        rules.push(rel);
      }
    };

    await walk(skillPath);
    return [...new Set(rules)].sort((a, b) => a.localeCompare(b));
  }

  private async loadSkillFrom(
    baseDir: string,
    source: Skill['source'],
    name: string
  ): Promise<Skill | null> {
    const skillPath = join(baseDir, name);
    const mainFile = await this.resolveMainFile(skillPath);
    if (!mainFile) {
      return null;
    }

    try {
      const content = await fs.readFile(mainFile, 'utf8');
      const ruleFiles = await this.collectRuleFiles(skillPath, mainFile);
      return { name, path: skillPath, content, ruleFiles, source };
    } catch {
      return null;
    }
  }

  async getSkill(name: string): Promise<Skill | null> {
    const workspaceSkill = await this.loadSkillFrom(this.workspaceSkillsDir, 'workspace', name);
    if (workspaceSkill) {
      return workspaceSkill;
    }
    return this.loadSkillFrom(this.homeSkillsDir, 'global', name);
  }

  async hasGlobalSkills(): Promise<boolean> {
    try {
      const entries = await fs.readdir(this.homeSkillsDir, { withFileTypes: true });
      return entries.some((entry) => entry.isDirectory());
    } catch {
      return false;
    }
  }

  async installSkill(url: string, name?: string): Promise<{ name: string; path: string }> {
    const inferredName = name ?? url.split('/').pop()?.replace(/\.git$/, '') ?? 'unnamed-skill';
    const targetPath = join(this.homeSkillsDir, inferredName);

    try {
      await fs.access(targetPath);
      // Already exists - pull updates
      await execFileAsync('git', ['-C', targetPath, 'pull'], { timeout: 30_000 });
    } catch {
      // Clone new
      await execFileAsync('git', ['clone', '--depth', '1', url, targetPath], { timeout: 60_000 });
    }

    return { name: inferredName, path: targetPath };
  }

  async checkPrerequisites(skill: Skill): Promise<PrerequisiteCheckResult> {
    const prereqs = parsePrerequisites(skill.content);
    const missingBins: string[] = [];
    const missingEnv: string[] = [];
    const hints: string[] = [];

    if (prereqs.bins) {
      for (const bin of prereqs.bins) {
        if (!(await commandExists(bin))) {
          missingBins.push(bin);
          hints.push(`Install '${bin}' (e.g., apt install ${bin} / brew install ${bin})`);
        }
      }
    }

    if (prereqs.env) {
      for (const envVar of prereqs.env) {
        if (!process.env[envVar]) {
          missingEnv.push(envVar);
          hints.push(`Set environment variable: export ${envVar}=...`);
        }
      }
    }

    return {
      ok: missingBins.length === 0 && missingEnv.length === 0,
      missingBins,
      missingEnv,
      hints,
    };
  }

  async getSkillsForSystemPrompt(): Promise<string> {
    const skills = await this.listSkills();
    if (skills.length === 0) return '';

    const lines = [
      '## Installed Skills',
      'IMPORTANT: Always prefer `skill.run` over other tools (search, web fetch, etc.) when an installed skill matches the user\'s request. Skills are purpose-built and more reliable.',
    ];
    for (const name of skills) {
      const skill = await this.getSkill(name);
      if (skill) {
        const fm = parseFrontmatter(skill.content);
        const desc = typeof fm.description === 'string' ? fm.description : '';
        lines.push(`- **${name}**: ${desc || '(no description)'}`);
      }
    }
    return lines.join('\n');
  }
}

// ── Plugin factory ──────────────────────────────────────────────────────

function resolveHomeSkillsDir(): string {
  return join(process.env.HOME ?? process.env.USERPROFILE ?? '/tmp', '.skills');
}

/**
 * Skills plugin — manage and run global (~/.skills/) and workspace SKILL.md modules.
 *
 * Tools:
 *  - `skill.run`     — Load a skill by name, check prerequisites, return its content.
 *  - `skill.install`  — Clone a skill from a GitHub URL into ~/.skills/.
 *
 * Commands:
 *  - `/skill list`        — List all installed skills (global + workspace).
 *  - `/skill info <name>` — Show skill details and prerequisite status.
 *  - `/skill run <name>`  — Run a skill from the TUI.
 *
 * Services:
 *  - `skills.manager` — SkillManager instance for programmatic access.
 *
 * Context provider:
 *  - `skills.installed` — Lists installed skills in the system prompt.
 */
export function createSkillsPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Skills',
      version: '0.1.0',
      main: 'bundled',
      description: 'Skill management: global (~/.skills/) + workspace overrides + install/run tools',
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const manager = new SkillManager(workspaceRoot, resolveHomeSkillsDir());

      context.registerService({
        id: 'skills.manager',
        pluginId: PLUGIN_ID,
        description: 'Skill manager service',
        implementation: manager,
      });

      context.registerTool({
        id: 'skill.run',
        title: 'Run',
        pluginId: PLUGIN_ID,
        description: 'Run an installed skill by name. ALWAYS prefer this over search or web fetch when a matching skill exists. Skills are purpose-built and return better results. Pass the user\'s request as the task argument.',
        parameters: z.object({
          name: z.string().describe('Skill name (e.g. "weather", "github", "slack")'),
          task: z.string().optional().describe('The user\'s request to pass to the skill'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const name = asString(input.name, 'name');
            const task = typeof input.task === 'string' ? input.task : undefined;

            await manager.init();
            const skill = await manager.getSkill(name);
            if (!skill) {
              return { ok: false, error: { code: 'SKILL_NOT_FOUND', message: `Skill not found: ${name}` } };
            }

            // Check prerequisites
            const prereqCheck = await manager.checkPrerequisites(skill);
            if (!prereqCheck.ok) {
              return {
                ok: false,
                error: {
                  code: 'SKILL_PREREQ_MISSING',
                  message: `Prerequisites not met for skill '${name}'`,
                  hint: prereqCheck.hints.join('; '),
                },
              };
            }

            const body = stripFrontmatter(skill.content);
            const ruleList =
              skill.ruleFiles.length > 0
                ? `\n\n[AVAILABLE RULE FILES]:\n${skill.ruleFiles.map((f) => `- ${f}`).join('\n')}`
                : '';

            const taskSuffix = task ? `\n\n[TASK: ${task}]` : '';
            const output = `[SKILL: ${name}]\nFollow these instructions to complete the task. Do not use other tools unless the skill instructions tell you to.\n\n${body}${ruleList}${taskSuffix}`;

            return { ok: true, output };
          } catch (err) {
            return { ok: false, error: { code: 'SKILL_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'skill.install',
        title: 'Install',
        pluginId: PLUGIN_ID,
        description: 'Install a skill from a GitHub URL into ~/.skills/.',
        parameters: z.object({
          url: z.string().describe('Git URL to clone the skill from'),
          name: z.string().optional().describe('Override the skill directory name'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const url = asString(input.url, 'url');
            const name = typeof input.name === 'string' ? input.name : undefined;

            await manager.init();
            const result = await manager.installSkill(url, name);

            return { ok: true, output: result as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'SKILL_INSTALL_ERROR', message: String(err) } };
          }
        },
      });

      context.registerCommand({
        id: 'skill',
        pluginId: PLUGIN_ID,
        description: 'Skill management (list, run <name>, info <name>)',
        subcommands: ['list', 'run', 'info'],
        execute: async (args, commandContext) => {
          const sub = (args[0] ?? 'list').toLowerCase();

          if (sub === 'list') {
            await manager.init();
            const skills = await manager.listSkills();
            if (skills.length === 0) {
              commandContext.stdout.write('No skills installed.\n');
            } else {
              commandContext.stdout.write(`Installed skills:\n${skills.map((s) => `  - ${s}`).join('\n')}\n`);
            }
            return 0;
          }

          if (sub === 'info') {
            const name = args[1];
            if (!name) {
              commandContext.stderr.write('Usage: /skill info <name>\n');
              return 1;
            }
            await manager.init();
            const skill = await manager.getSkill(name);
            if (!skill) {
              commandContext.stderr.write(`Skill not found: ${name}\n`);
              return 1;
            }
            const prereqCheck = await manager.checkPrerequisites(skill);
            commandContext.stdout.write(
              `Skill: ${skill.name}\nSource: ${skill.source}\nPath: ${skill.path}\nRule files: ${skill.ruleFiles.length}\nPrerequisites: ${prereqCheck.ok ? 'OK' : `MISSING — ${prereqCheck.hints.join('; ')}`}\n`
            );
            return 0;
          }

          if (sub === 'run') {
            const name = args[1];
            if (!name) {
              commandContext.stderr.write('Usage: /skill run <name> [task...]\n');
              return 1;
            }
            await manager.init();
            const skill = await manager.getSkill(name);
            if (!skill) {
              commandContext.stderr.write(`Skill not found: ${name}\n`);
              return 1;
            }
            const prereqCheck = await manager.checkPrerequisites(skill);
            if (!prereqCheck.ok) {
              commandContext.stderr.write(`Prerequisites not met:\n${prereqCheck.hints.map((h) => `  - ${h}`).join('\n')}\n`);
              return 1;
            }
            const task = args.slice(2).join(' ') || undefined;
            const ruleList = skill.ruleFiles.length > 0
              ? `\n\n[AVAILABLE RULE FILES]:\n${skill.ruleFiles.map((f) => `- ${f}`).join('\n')}`
              : '';
            const taskSuffix = task ? `\n\n[TASK: ${task}]` : '';
            const body = stripFrontmatter(skill.content);
            commandContext.stdout.write(`[SKILL: ${name}]\n${body}${ruleList}${taskSuffix}\n`);
            return 0;
          }

          commandContext.stderr.write(`Unknown skill subcommand: ${sub}\n`);
          return 1;
        },
      });

      context.contributeContextProvider({
        id: 'skills.installed',
        pluginId: PLUGIN_ID,
        priority: 30,
        provide: async () => {
          await manager.init();
          const hasGlobal = await manager.hasGlobalSkills();
          const header = hasGlobal ? 'Slashbot skills are available.' : '';
          const details = await manager.getSkillsForSystemPrompt();
          return [header, details].filter((part) => part.length > 0).join('\n\n');
        },
      });
    },
  };
}

export { createSkillsPlugin as createPlugin };

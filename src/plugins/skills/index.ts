import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { JsonValue, RuntimeConfig, SlashbotPlugin } from '@slashbot/plugin-sdk';
import { asObject, asString } from '../utils.js';
import { buildSkillEnv } from './env-overrides.js';
import { SkillManager } from './manager.js';
import { PLUGIN_ID } from './types.js';
import type { SkillsConfig } from './types.js';

function resolveHomeSkillsDir(): string {
  return join(process.env.HOME ?? process.env.USERPROFILE ?? '/tmp', '.skills');
}

function resolveBundledSkillsDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', '..', '..', 'skills');
}

function sourceTag(source: string): string {
  switch (source) {
    case 'bundled': return '[B]';
    case 'global': return '[G]';
    case 'workspace': return '[W]';
    default: return '[?]';
  }
}

/**
 * Skills plugin — manage and run bundled, global (~/.skills/), and workspace SKILL.md modules.
 *
 * Tools:
 *  - `skill.run`      — Load a skill by name, check prerequisites, return its content.
 *  - `skill.install`   — Clone a skill from a GitHub URL into ~/.skills/.
 *
 * Commands:
 *  - `/skill list`         — List all installed skills with source tags.
 *  - `/skill info <name>`  — Show skill details, metadata, and prerequisite status.
 *  - `/skill run <name>`   — Run a skill from the TUI.
 *  - `/skill check`        — Eligibility report for all skills.
 *
 * Services:
 *  - `skills.manager` — SkillManager instance for programmatic access.
 *
 * Context provider:
 *  - `skills.installed` — Lists eligible skills in the system prompt.
 */
export function createSkillsPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Skills',
      version: '0.2.0',
      main: 'bundled',
      description: 'Skill management: bundled + global (~/.skills/) + workspace overrides, with config & eligibility',
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const runtimeConfig = context.getService<RuntimeConfig>('kernel.config');
      const skillsConfig: SkillsConfig = runtimeConfig?.skills ?? { allowBundled: true, entries: {} };

      const manager = new SkillManager({
        workspaceRoot,
        homeSkillsDir: resolveHomeSkillsDir(),
        bundledSkillsDir: resolveBundledSkillsDir(),
        skillsConfig,
      });

      context.registerService({
        id: 'skills.manager',
        pluginId: PLUGIN_ID,
        description: 'Skill manager service',
        implementation: manager,
      });

      // ── skill.run tool ──

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

            // Check invocation policy
            if (skill.invocation.disableModelInvocation) {
              return {
                ok: false,
                error: {
                  code: 'SKILL_NOT_MODEL_INVOCABLE',
                  message: `Skill '${name}' is not available for direct model invocation. It can only be run by users via /skill run ${name}.`,
                },
              };
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

            // Build env overrides info
            const envOverrides = buildSkillEnv(name, skillsConfig);
            const envNote = Object.keys(envOverrides).length > 0
              ? `\n\n[ENV OVERRIDES]: ${Object.keys(envOverrides).join(', ')}`
              : '';

            const ruleList =
              skill.ruleFiles.length > 0
                ? `\n\n[AVAILABLE RULE FILES]:\n${skill.ruleFiles.map((f) => `- ${f}`).join('\n')}`
                : '';

            const taskSuffix = task ? `\n\n[TASK: ${task}]` : '';
            const output = `[SKILL: ${name}]\nFollow these instructions to complete the task. Do not use other tools unless the skill instructions tell you to.\n\n${skill.body}${ruleList}${envNote}${taskSuffix}`;

            return { ok: true, output };
          } catch (err) {
            return { ok: false, error: { code: 'SKILL_ERROR', message: String(err) } };
          }
        },
      });

      // ── skill.install tool ──

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

      // ── /skill command ──

      context.registerCommand({
        id: 'skill',
        pluginId: PLUGIN_ID,
        description: 'Skill management (list, run <name>, info <name>, check)',
        subcommands: ['list', 'run', 'info', 'check'],
        execute: async (args, commandContext) => {
          const sub = (args[0] ?? 'list').toLowerCase();

          if (sub === 'list') {
            await manager.init();
            const names = await manager.listSkillNames();
            if (names.length === 0) {
              commandContext.stdout.write('No skills installed.\n');
            } else {
              const lines: string[] = [];
              for (const name of names) {
                const entry = await manager.getSkill(name);
                if (!entry) continue;
                const tag = sourceTag(entry.source);
                const disabled = skillsConfig.entries[name]?.enabled === false ? ' (disabled)' : '';
                const emoji = entry.frontmatter.slashbot?.emoji ?? '';
                const prefix = emoji ? `${emoji} ` : '';
                lines.push(`  ${tag} ${prefix}${name}${disabled}`);
              }
              commandContext.stdout.write(`Installed skills:\n${lines.join('\n')}\n`);
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
            const fm = skill.frontmatter;
            const meta = fm.slashbot;
            const lines = [
              `Skill: ${skill.name}`,
              `Source: ${skill.source}`,
              `Path: ${skill.path}`,
              `Description: ${fm.description ?? '(none)'}`,
            ];
            if (meta?.emoji) lines.push(`Emoji: ${meta.emoji}`);
            if (meta?.primaryEnv) lines.push(`Primary env: ${meta.primaryEnv}`);
            if (meta?.os) lines.push(`OS: ${meta.os.join(', ')}`);
            if (meta?.requires) {
              if (meta.requires.bins) lines.push(`Requires bins: ${meta.requires.bins.join(', ')}`);
              if (meta.requires.anyBins) lines.push(`Requires any of: ${meta.requires.anyBins.join(', ')}`);
              if (meta.requires.env) lines.push(`Requires env: ${meta.requires.env.join(', ')}`);
              if (meta.requires.config) lines.push(`Requires config: ${meta.requires.config.join(', ')}`);
            }
            lines.push(`Rule files: ${skill.ruleFiles.length}`);
            lines.push(`User invocable: ${skill.invocation.userInvocable ? 'yes' : 'no'}`);
            lines.push(`Model invocable: ${skill.invocation.disableModelInvocation ? 'no' : 'yes'}`);
            lines.push(`Prerequisites: ${prereqCheck.ok ? 'OK' : `MISSING — ${prereqCheck.hints.join('; ')}`}`);
            commandContext.stdout.write(lines.join('\n') + '\n');
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
            commandContext.stdout.write(`[SKILL: ${name}]\n${skill.body}${ruleList}${taskSuffix}\n`);
            return 0;
          }

          if (sub === 'check') {
            await manager.init();
            const report = await manager.getStatusReport();
            const lines = [
              `Skills status: ${report.total} total, ${report.eligible} eligible, ${report.disabled} disabled, ${report.ineligible} ineligible`,
              '',
            ];
            for (const entry of report.entries) {
              const tag = sourceTag(entry.source);
              let status: string;
              if (entry.eligible) {
                status = 'OK';
              } else if (entry.disabled) {
                status = 'DISABLED';
              } else {
                status = `INELIGIBLE — ${entry.reasons.join('; ')}`;
              }
              lines.push(`  ${tag} ${entry.name}: ${status}`);
            }
            commandContext.stdout.write(lines.join('\n') + '\n');
            return 0;
          }

          commandContext.stderr.write(`Unknown skill subcommand: ${sub}\n`);
          return 1;
        },
      });

      // ── Context provider ──

      context.contributeContextProvider({
        id: 'skills.installed',
        pluginId: PLUGIN_ID,
        priority: 30,
        provide: async () => {
          await manager.init();
          const hasAny = await manager.hasSkills();
          const header = hasAny ? 'Slashbot skills are available.' : '';
          const details = await manager.getSkillsForSystemPrompt();
          return [header, details].filter((part) => part.length > 0).join('\n\n');
        },
      });
    },
  };
}

export { createSkillsPlugin as createPlugin };

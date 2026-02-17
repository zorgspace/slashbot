import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { checkPrerequisites, shouldIncludeSkill } from './eligibility.js';
import { parseFrontmatter, resolveInvocationPolicy, stripFrontmatter } from './frontmatter.js';
import type {
  PrerequisiteResult,
  SkillEntry,
  SkillSource,
  SkillsConfig,
  StatusReport,
  StatusReportEntry,
} from './types.js';

const execFileAsync = promisify(execFile);

/**
 * SkillManager — three-tier skill discovery, loading, and validation.
 *
 * Precedence: workspace > global > bundled.
 * Skills are directories containing a SKILL.md (or skill.md) file with optional
 * frontmatter (prerequisites, metadata, invocation policy) and additional rule
 * files (*.md).
 */
export class SkillManager {
  private readonly workspaceSkillsDir: string;
  private readonly homeSkillsDir: string;
  private readonly bundledSkillsDir: string;
  private readonly skillsConfig: SkillsConfig;

  constructor(opts: {
    workspaceRoot: string;
    homeSkillsDir: string;
    bundledSkillsDir: string;
    skillsConfig: SkillsConfig;
  }) {
    this.workspaceSkillsDir = join(opts.workspaceRoot, '.slashbot', 'skills');
    this.homeSkillsDir = opts.homeSkillsDir;
    this.bundledSkillsDir = opts.bundledSkillsDir;
    this.skillsConfig = opts.skillsConfig;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.homeSkillsDir, { recursive: true });
  }

  /** List all skill names, deduplicated, sorted. */
  async listSkillNames(): Promise<string[]> {
    const [workspace, global, bundled] = await Promise.all([
      this.listSkillNamesFrom(this.workspaceSkillsDir),
      this.listSkillNamesFrom(this.homeSkillsDir),
      this.listSkillNamesFrom(this.bundledSkillsDir),
    ]);
    return [...new Set([...workspace, ...global, ...bundled])].sort((a, b) => a.localeCompare(b));
  }

  /** Get a skill by name. Highest-precedence source wins: workspace > global > bundled. */
  async getSkill(name: string): Promise<SkillEntry | null> {
    const sources: Array<{ dir: string; source: SkillSource }> = [
      { dir: this.workspaceSkillsDir, source: 'workspace' },
      { dir: this.homeSkillsDir, source: 'global' },
      { dir: this.bundledSkillsDir, source: 'bundled' },
    ];

    for (const { dir, source } of sources) {
      const entry = await this.loadSkillFrom(dir, source, name);
      if (entry) return entry;
    }
    return null;
  }

  /** Get all eligible skills (passes config, OS, prerequisites). */
  async getEligibleSkills(): Promise<SkillEntry[]> {
    const names = await this.listSkillNames();
    const eligible: SkillEntry[] = [];

    for (const name of names) {
      const entry = await this.getSkill(name);
      if (!entry) continue;
      const { included } = await shouldIncludeSkill(entry, this.skillsConfig);
      if (included) eligible.push(entry);
    }

    return eligible;
  }

  /** Check prerequisites for a skill entry. */
  async checkPrerequisites(entry: SkillEntry): Promise<PrerequisiteResult> {
    return checkPrerequisites(entry.frontmatter.slashbot, entry.name, this.skillsConfig);
  }

  /** Generate system prompt text listing eligible skills. */
  async getSkillsForSystemPrompt(): Promise<string> {
    const eligible = await this.getEligibleSkills();
    if (eligible.length === 0) return '';

    const lines = [
      '## Installed Skills',
      "IMPORTANT: Always prefer `skill.run` over other tools (search, web fetch, etc.) when an installed skill matches the user's request. Skills are purpose-built and more reliable.",
    ];

    for (const entry of eligible) {
      if (entry.invocation.disableModelInvocation) continue;
      const emoji = entry.frontmatter.slashbot?.emoji ?? '';
      const desc = entry.frontmatter.description ?? '(no description)';
      const prefix = emoji ? `${emoji} ` : '';
      lines.push(`- ${prefix}**${entry.name}**: ${desc}`);
    }

    return lines.join('\n');
  }

  /** Check if there are any skills available at all. */
  async hasSkills(): Promise<boolean> {
    const names = await this.listSkillNames();
    return names.length > 0;
  }

  /** Install a skill from a git URL into ~/.skills/. */
  async installSkill(url: string, name?: string): Promise<{ name: string; path: string }> {
    const inferredName = name ?? url.split('/').pop()?.replace(/\.git$/, '') ?? 'unnamed-skill';
    const targetPath = join(this.homeSkillsDir, inferredName);

    try {
      await fs.access(targetPath);
      await execFileAsync('git', ['-C', targetPath, 'pull'], { timeout: 30_000 });
    } catch {
      await execFileAsync('git', ['clone', '--depth', '1', url, targetPath], { timeout: 60_000 });
    }

    return { name: inferredName, path: targetPath };
  }

  /** Generate a full status report for /skill check. */
  async getStatusReport(): Promise<StatusReport> {
    const names = await this.listSkillNames();
    const entries: StatusReportEntry[] = [];
    let eligible = 0;
    let disabled = 0;
    let ineligible = 0;

    for (const name of names) {
      const entry = await this.getSkill(name);
      if (!entry) continue;

      const { included, reasons } = await shouldIncludeSkill(entry, this.skillsConfig);
      const isDisabled = this.skillsConfig.entries[name]?.enabled === false;

      if (included) {
        eligible++;
      } else if (isDisabled) {
        disabled++;
      } else {
        ineligible++;
      }

      entries.push({
        name,
        source: entry.source,
        eligible: included,
        disabled: isDisabled,
        reasons,
      });
    }

    return { total: names.length, eligible, disabled, ineligible, entries };
  }

  get config(): SkillsConfig {
    return this.skillsConfig;
  }

  // ── Private ──

  private async listSkillNamesFrom(baseDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      const names: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(baseDir, entry.name);
        const mainFile = await this.resolveMainFile(skillPath);
        if (mainFile) names.push(entry.name);
      }
      return names;
    } catch {
      return [];
    }
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
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
        const rel = relative(skillPath, fullPath).replace(/\\/g, '/');
        if (rel.toLowerCase() === mainRel) continue;
        rules.push(rel);
      }
    };

    await walk(skillPath);
    return [...new Set(rules)].sort((a, b) => a.localeCompare(b));
  }

  private async loadSkillFrom(
    baseDir: string,
    source: SkillSource,
    name: string,
  ): Promise<SkillEntry | null> {
    const skillPath = join(baseDir, name);
    const mainFile = await this.resolveMainFile(skillPath);
    if (!mainFile) return null;

    try {
      const content = await fs.readFile(mainFile, 'utf8');
      const ruleFiles = await this.collectRuleFiles(skillPath, mainFile);
      const frontmatter = parseFrontmatter(content);
      const invocation = resolveInvocationPolicy(frontmatter);
      const body = stripFrontmatter(content);

      return { name, path: skillPath, content, body, ruleFiles, source, frontmatter, invocation };
    } catch {
      return null;
    }
  }
}

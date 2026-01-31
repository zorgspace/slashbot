/**
 * Skill Manager - Download, store, and invoke skills
 *
 * Skills are stored in ~/.slashbot/skills/ (home directory) for global access
 * They can be downloaded from URLs and invoked by user (/skill_name) or by Grok automatically.
 */

import path from 'path';
import { c } from '../ui/colors';
import { HOME_SKILLS_DIR } from '../constants';

export interface Skill {
  name: string;
  path: string;
  content: string;
  metadata?: {
    name?: string;
    description?: string;
    version?: string;
    homepage?: string;
    triggers?: string[];
  };
}

export interface SkillManager {
  init(): Promise<void>;
  listSkills(): Promise<Skill[]>;
  getSkill(name: string): Promise<Skill | null>;
  installSkill(url: string, name?: string): Promise<Skill>;
  removeSkill(name: string): Promise<boolean>;
  getSkillsDir(): string;
  getSkillsForSystemPrompt(): Promise<string>;
}

/**
 * Parse skill metadata from markdown frontmatter
 */
function parseSkillMetadata(content: string): { metadata: Skill['metadata']; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { metadata: {}, body: content };
  }

  const [, frontmatter, body] = frontmatterMatch;
  const metadata: Skill['metadata'] = {};

  // Parse YAML-like frontmatter (simple key: value pairs)
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (key === 'name') metadata.name = value;
      else if (key === 'description') metadata.description = value;
      else if (key === 'version') metadata.version = value;
      else if (key === 'homepage') metadata.homepage = value;
      else if (key === 'triggers') {
        // Parse comma-separated triggers
        metadata.triggers = value.split(',').map(t => t.trim().replace(/['"]/g, ''));
      }
    }
  }

  return { metadata, body };
}

/**
 * Extract skill name from URL or filename
 */
function extractSkillName(url: string): string {
  // Try to get name from URL path
  const urlPath = new URL(url).pathname;
  const filename = path.basename(urlPath);

  // Remove .md extension
  let name = filename.replace(/\.md$/i, '');

  // Handle common patterns like skill.md, SKILL.md
  if (name.toLowerCase() === 'skill') {
    // Try to get name from domain or parent path
    const parts = urlPath.split('/').filter(p => p && p.toLowerCase() !== 'skill.md');
    if (parts.length > 0) {
      name = parts[parts.length - 1];
    }
  }

  // Sanitize: lowercase, replace non-alphanumeric with hyphens
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function createSkillManager(_basePath?: string): SkillManager {
  // Skills are stored in home directory for global access across all projects
  const skillsDir = HOME_SKILLS_DIR;

  return {
    getSkillsDir(): string {
      return skillsDir;
    },

    async init(): Promise<void> {
      const { mkdir } = await import('fs/promises');
      await mkdir(skillsDir, { recursive: true });
    },

    async listSkills(): Promise<Skill[]> {
      const skills: Skill[] = [];

      try {
        const { readdir } = await import('fs/promises');
        const entries = await readdir(skillsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            // Check for skill.md inside directory
            const skillPath = path.join(skillsDir, entry.name, 'skill.md');
            const file = Bun.file(skillPath);
            if (await file.exists()) {
              const content = await file.text();
              const { metadata } = parseSkillMetadata(content);
              skills.push({
                name: entry.name,
                path: skillPath,
                content,
                metadata,
              });
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            // Direct .md file
            const skillPath = path.join(skillsDir, entry.name);
            const content = await Bun.file(skillPath).text();
            const { metadata } = parseSkillMetadata(content);
            skills.push({
              name: entry.name.replace(/\.md$/, ''),
              path: skillPath,
              content,
              metadata,
            });
          }
        }
      } catch {
        // Skills directory doesn't exist yet
      }

      return skills;
    },

    async getSkill(name: string): Promise<Skill | null> {
      const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Check for directory-based skill first
      const dirPath = path.join(skillsDir, normalizedName, 'skill.md');
      const dirFile = Bun.file(dirPath);
      if (await dirFile.exists()) {
        const content = await dirFile.text();
        const { metadata } = parseSkillMetadata(content);
        return {
          name: normalizedName,
          path: dirPath,
          content,
          metadata,
        };
      }

      // Check for file-based skill
      const filePath = path.join(skillsDir, `${normalizedName}.md`);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const content = await file.text();
        const { metadata } = parseSkillMetadata(content);
        return {
          name: normalizedName,
          path: filePath,
          content,
          metadata,
        };
      }

      return null;
    },

    async installSkill(url: string, name?: string): Promise<Skill> {
      const { mkdir } = await import('fs/promises');

      // Fetch the skill content
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Slashbot/1.0 (Skill Installer)',
          Accept: 'text/markdown,text/plain,*/*',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch skill: HTTP ${response.status}`);
      }

      const content = await response.text();
      const { metadata } = parseSkillMetadata(content);

      // Determine skill name: prefer explicit name param, then metadata name, then extract from URL
      const skillName =
        name || metadata?.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || extractSkillName(url);

      // Create skill directory and write file
      const skillDir = path.join(skillsDir, skillName);
      await mkdir(skillDir, { recursive: true });

      const skillPath = path.join(skillDir, 'skill.md');
      await Bun.write(skillPath, content);

      return {
        name: skillName,
        path: skillPath,
        content,
        metadata,
      };
    },

    async removeSkill(name: string): Promise<boolean> {
      const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const { rm } = await import('fs/promises');

      // Try directory-based skill
      const dirPath = path.join(skillsDir, normalizedName);
      try {
        await rm(dirPath, { recursive: true });
        return true;
      } catch {
        // Try file-based skill
        const filePath = path.join(skillsDir, `${normalizedName}.md`);
        try {
          await rm(filePath);
          return true;
        } catch {
          return false;
        }
      }
    },

    async getSkillsForSystemPrompt(): Promise<string> {
      const skills = await this.listSkills();

      if (skills.length === 0) {
        return '';
      }

      let prompt = '\n\n# Installed Skills\n';

      for (const skill of skills) {
        const desc = skill.metadata?.description || 'No description';
        const version = skill.metadata?.version ? ` v${skill.metadata.version}` : '';
        prompt += `- **${skill.name}**${version}: ${desc}\n`;
      }

      prompt +=
        '\nTo use: [[skill name="skill_name"/]] → then execute curl commands from the loaded content.\n';

      return prompt;
    },
  };
}

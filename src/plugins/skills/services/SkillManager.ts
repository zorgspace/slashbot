/**
 * Skill Manager - Download, store, and invoke skills
 *
 * Skills are stored in ~/.slashbot/skills/ (home directory) for global access
 * They can be downloaded from URLs and invoked by user (/skill_name) or by Grok automatically.
 */

import path from 'path';
import { display } from '../../../core/ui';
import { HOME_SKILLS_DIR, DEFAULT_SKILLS } from '../../../core/config/constants';

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
  installFromGitHub(
    owner: string,
    repo: string,
    branch: string,
    subpath: string,
    name?: string,
  ): Promise<Skill>;
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
 * Extract relative .md file paths from markdown content
 * Looks for patterns like [text](./path/to/file.md) or [text](path/to/file.md)
 */
function extractRelativeMdPaths(content: string): string[] {
  const paths: string[] = [];
  const seenPaths = new Set<string>();

  // Pattern: Markdown links to .md files - [text](path.md) or [text](./path.md)
  // Captures relative paths only (not http:// or https://)
  const mdLinkPattern = /\[[^\]]*\]\((?!https?:\/\/)([^)]+\.md)\)/gi;
  let match;
  while ((match = mdLinkPattern.exec(content)) !== null) {
    let relativePath = match[1];
    // Normalize path - remove leading ./
    if (relativePath.startsWith('./')) {
      relativePath = relativePath.slice(2);
    }
    if (!seenPaths.has(relativePath)) {
      seenPaths.add(relativePath);
      paths.push(relativePath);
    }
  }

  return paths;
}

/**
 * Extract subskill URLs from skill content
 * Looks for URLs in markdown tables or bash install scripts
 */
function extractSubskillUrls(content: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const seenUrls = new Set<string>();

  // Get the base domain from the main skill URL
  let baseDomain: string;
  try {
    const url = new URL(baseUrl);
    baseDomain = `${url.protocol}//${url.host}`;
  } catch {
    return urls;
  }

  // Pattern 1: Markdown table with URLs like `https://bags.fm/culture.md`
  const tableUrlPattern = /`(https?:\/\/[^`\s]+\.(?:md|json))`/gi;
  let match;
  while ((match = tableUrlPattern.exec(content)) !== null) {
    const url = match[1];
    // Skip the main skill.md itself
    if (!url.toLowerCase().endsWith('/skill.md') && !seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push(url);
    }
  }

  // Pattern 2: Curl commands like "curl -s https://bags.fm/culture.md > ..."
  const curlPattern = /curl\s+(?:-[sS]\s+)?(https?:\/\/[^\s>]+\.(?:md|json))/gi;
  while ((match = curlPattern.exec(content)) !== null) {
    const url = match[1];
    if (!url.toLowerCase().endsWith('/skill.md') && !seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push(url);
    }
  }

  // Pattern 3: Relative references in tables like | **AUTH.md** | that could be resolved
  const relativePattern = /\|\s*\*\*([A-Z_]+\.(?:md|json))\*\*\s*\|/gi;
  while ((match = relativePattern.exec(content)) !== null) {
    const filename = match[1].toLowerCase();
    const fullUrl = `${baseDomain}/${filename}`;
    if (!filename.endsWith('skill.md') && !seenUrls.has(fullUrl)) {
      seenUrls.add(fullUrl);
      urls.push(fullUrl);
    }
  }

  return urls;
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

      // Install default skills if not already installed
      for (const defaultSkill of DEFAULT_SKILLS) {
        const existingSkill = await this.getSkill(defaultSkill.name);
        if (!existingSkill) {
          try {
            await this.installSkill(defaultSkill.url, defaultSkill.name);
            display.muted(`Installed default skill: ${defaultSkill.name}`);
          } catch (error) {
            // Silently ignore if default skill installation fails (e.g., network issues)
            display.errorText(`Failed to install default skill ${defaultSkill.name}: ${error}`);
          }
        }
      }
    },

    async listSkills(): Promise<Skill[]> {
      const skills: Skill[] = [];

      try {
        const { readdir } = await import('fs/promises');
        const entries = await readdir(skillsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            // Check for skill.md inside directory (case-insensitive)
            const dirEntries = await readdir(path.join(skillsDir, entry.name));
            const skillFile = dirEntries.find(f => f.toLowerCase() === 'skill.md');
            if (skillFile) {
              const skillPath = path.join(skillsDir, entry.name, skillFile);
              const file = Bun.file(skillPath);
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
      const { readdir } = await import('fs/promises');
      const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Check for directory-based skill first (case-insensitive skill.md lookup)
      const skillDirPath = path.join(skillsDir, normalizedName);
      try {
        const dirEntries = await readdir(skillDirPath);
        const skillFile = dirEntries.find(f => f.toLowerCase() === 'skill.md');
        if (skillFile) {
          const dirPath = path.join(skillDirPath, skillFile);
          const content = await Bun.file(dirPath).text();
          const { metadata } = parseSkillMetadata(content);
          return {
            name: normalizedName,
            path: dirPath,
            content,
            metadata,
          };
        }
      } catch {
        // Directory doesn't exist, continue to file-based check
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

      // Check if this is a GitHub repository/directory URL
      const githubMatch = url.match(
        /github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?(?:\/(.+))?$/,
      );

      if (githubMatch) {
        // GitHub repository - download all files including subfolders
        const [, owner, repo, branch = 'main', subpath = ''] = githubMatch;
        return await this.installFromGitHub(owner, repo, branch, subpath, name);
      }

      // Single file URL - original behavior
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

      // Get base URL for resolving relative paths
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

      // Recursively download relative .md files
      const downloadedPaths = new Set<string>(['skill.md']);
      const queue: Array<{ relativePath: string; content: string }> = [
        { relativePath: 'skill.md', content },
      ];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const relativeMdPaths = extractRelativeMdPaths(current.content);

        for (const relativePath of relativeMdPaths) {
          // Resolve path relative to current file's directory
          const currentDir = path.dirname(current.relativePath);
          const resolvedPath =
            currentDir === '.' ? relativePath : path.join(currentDir, relativePath);
          const normalizedPath = path.normalize(resolvedPath);

          // Skip if already downloaded
          if (downloadedPaths.has(normalizedPath)) continue;
          downloadedPaths.add(normalizedPath);

          try {
            // Build full URL for download
            const fullUrl = new URL(normalizedPath, baseUrl).href;

            const subResponse = await fetch(fullUrl, {
              headers: {
                'User-Agent': 'Slashbot/1.0 (Skill Installer)',
                Accept: 'text/markdown,text/plain,*/*',
              },
              redirect: 'follow',
            });

            if (subResponse.ok) {
              const subContent = await subResponse.text();

              // Create subdirectory if needed
              const targetPath = path.join(skillDir, normalizedPath);
              const targetDir = path.dirname(targetPath);
              await mkdir(targetDir, { recursive: true });

              await Bun.write(targetPath, subContent);

              // Add to queue for recursive processing
              queue.push({ relativePath: normalizedPath, content: subContent });
            }
          } catch {
            // Silently ignore failed downloads
          }
        }
      }

      // Also download absolute URL subskills (legacy behavior)
      const subskillUrls = extractSubskillUrls(content, url);
      for (const subskillUrl of subskillUrls) {
        try {
          const subResponse = await fetch(subskillUrl, {
            headers: {
              'User-Agent': 'Slashbot/1.0 (Skill Installer)',
              Accept: 'text/markdown,text/plain,application/json,*/*',
            },
            redirect: 'follow',
          });

          if (subResponse.ok) {
            const subContent = await subResponse.text();
            // Extract filename from URL
            const subFilename = path.basename(new URL(subskillUrl).pathname);
            const subPath = path.join(skillDir, subFilename);
            await Bun.write(subPath, subContent);
          }
        } catch {
          // Silently ignore failed subskill downloads
        }
      }

      return {
        name: skillName,
        path: skillPath,
        content,
        metadata,
      };
    },

    async installFromGitHub(
      owner: string,
      repo: string,
      branch: string,
      subpath: string,
      name?: string,
    ): Promise<Skill> {
      const { mkdir } = await import('fs/promises');

      // Get repository tree from GitHub API
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Slashbot/1.0 (Skill Installer)',
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch GitHub tree: HTTP ${response.status}`);
      }

      const data = await response.json();
      const tree = data.tree as Array<{ path: string; type: string; url?: string }>;

      // Filter files that match the subpath
      const prefix = subpath ? `${subpath}/` : '';
      const files = tree.filter(
        item => item.type === 'blob' && (subpath ? item.path.startsWith(prefix) : true),
      );

      if (files.length === 0) {
        throw new Error(`No files found in ${owner}/${repo}/${subpath || ''}`);
      }

      // Determine skill name from repo name or subpath
      const skillName =
        name || (subpath ? path.basename(subpath) : repo).toLowerCase().replace(/[^a-z0-9-]/g, '-');

      const skillDir = path.join(skillsDir, skillName);
      await mkdir(skillDir, { recursive: true });

      // Download all files
      let skillContent = '';
      let skillMetadata: Skill['metadata'] = {};
      const failedFiles: string[] = [];

      for (const file of files) {
        // Calculate relative path within skill directory
        const relativePath = subpath ? file.path.slice(prefix.length) : file.path;
        const targetPath = path.join(skillDir, relativePath);

        // Create subdirectories if needed
        const targetDir = path.dirname(targetPath);
        await mkdir(targetDir, { recursive: true });

        // Download file content
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
        const fileResponse = await fetch(rawUrl, {
          headers: { 'User-Agent': 'Slashbot/1.0 (Skill Installer)' },
        });

        if (fileResponse.ok) {
          const content = await fileResponse.arrayBuffer();
          await Bun.write(targetPath, new Uint8Array(content));

          // If this is skill.md, parse its metadata
          if (relativePath === 'skill.md' || relativePath.endsWith('/skill.md')) {
            skillContent = new TextDecoder().decode(content);
            const parsed = parseSkillMetadata(skillContent);
            skillMetadata = parsed.metadata;
          }
        } else {
          failedFiles.push(`${file.path} (HTTP ${fileResponse.status})`);
        }
      }

      // If any files failed to download, throw an error to prevent partial installation
      if (failedFiles.length > 0) {
        throw new Error(
          `Failed to download ${failedFiles.length} file(s): ${failedFiles.join(', ')}`,
        );
      }

      // If no skill.md found, look for README.md or any .md file
      if (!skillContent) {
        const mdFile = files.find(
          f =>
            f.path.endsWith('skill.md') || f.path.endsWith('README.md') || f.path.endsWith('.md'),
        );
        if (mdFile) {
          const relativePath = subpath ? mdFile.path.slice(prefix.length) : mdFile.path;
          const mdPath = path.join(skillDir, relativePath);
          try {
            skillContent = await Bun.file(mdPath).text();
            const parsed = parseSkillMetadata(skillContent);
            skillMetadata = parsed.metadata;
          } catch {
            // Ignore
          }
        }
      }

      const skillPath = path.join(skillDir, 'skill.md');

      return {
        name: skillName,
        path: skillPath,
        content: skillContent,
        metadata: skillMetadata,
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
      prompt +=
        'The following skills are installed locally. Use them when the user request matches their purpose or triggers.\n\n';

      for (const skill of skills) {
        const desc = skill.metadata?.description || 'No description';
        const version = skill.metadata?.version ? ` v${skill.metadata.version}` : '';
        const triggers = skill.metadata?.triggers?.length
          ? ` (triggers: ${skill.metadata.triggers.join(', ')})`
          : '';
        prompt += `- **${skill.name}**${version}: ${desc}${triggers}\n`;
      }

      prompt += '\n## How to use skills\n';
      prompt += '- Load a skill with: <skill name="skill_name"/>\n';
      prompt += '- The skill content will be returned, then follow its instructions\n';
      prompt +=
        '- BEFORE doing a web search, check if an installed skill can answer the question\n';
      prompt +=
        "- When a user request matches a skill's triggers or purpose, load that skill first\n";
      prompt +=
        '\n**IMPORTANT:** When using a skill, follow its documentation completely. The skill is your primary and authoritative source - do NOT search for additional information unless the skill explicitly lacks what you need.\n';

      return prompt;
    },
  };
}

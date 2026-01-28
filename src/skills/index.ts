/**
 * Skills Module - Predefined helpers for gathering context on tasks
 */

export interface Skill {
  name: string;
  description: string;
  execute: () => Promise<string>;
}

const skills = new Map<string, Skill>();

skills.set('project-context', {
  name: 'project-context',
  description: 'Provides project structure, package.json, key files list, and git status for code engineering tasks.',
  async execute() {
    let context = '';
    try {
      const pkg = await Bun.file('package.json').text();
      context += `package.json summary:\n${pkg.substring(0, 1200)}...\n\n`;
    } catch {
      context += 'package.json not found.\n\n';
    }
    try {
      const result = await Bun.$`find . -maxdepth 3 -name "*.ts" | head -20`.text();
      context += `Project files:\n${result}\n\n`;
    } catch {
      context += 'Could not list files.\n\n';
    }
    try {
      const gitStatus = await Bun.$`git status --porcelain`.text();
      context += `Git status:\n${gitStatus}\n`;
    } catch {
      context += 'Not a git repo.\n';
    }
    return context;
  }
});

skills.set('git-context', {
  name: 'git-context',
  description: 'Detailed git status, branch, and recent commits.',
  async execute() {
    let context = '';
    try {
      context += await Bun.$`git status --short --branch`.text();
    } catch {}
    try {
      const logResult = await Bun.$`git log --oneline -10`.text();
      context += '\nRecent commits:\n' + logResult;
    } catch {}
    return context;
  }
});

export { skills };

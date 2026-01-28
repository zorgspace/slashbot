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

skills.set('init', {
  name: 'init',
  description: 'Comprehensive codebase analysis: code styling, conventions, architecture, key files. Use this to understand a new project.',
  async execute() {
    let context = '# Codebase Analysis\n\n';

    // 1. Project basics
    try {
      const pkg = await Bun.file('package.json').json();
      context += `## Project: ${pkg.name || 'Unknown'}\n`;
      if (pkg.description) context += `${pkg.description}\n`;
      context += `Version: ${pkg.version || 'N/A'}\n\n`;
    } catch {
      context += '## Project Analysis\n\n';
    }

    // 2. Code Styling Detection
    context += '## Code Styling & Formatting\n\n';

    // ESLint
    const eslintConfigs = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs'];
    for (const config of eslintConfigs) {
      try {
        const content = await Bun.file(config).text();
        context += `### ESLint (${config})\n\`\`\`\n${content.substring(0, 800)}\n\`\`\`\n\n`;
        break;
      } catch {}
    }

    // Prettier
    const prettierConfigs = ['.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yml', 'prettier.config.js', 'prettier.config.mjs'];
    for (const config of prettierConfigs) {
      try {
        const content = await Bun.file(config).text();
        context += `### Prettier (${config})\n\`\`\`\n${content.substring(0, 500)}\n\`\`\`\n\n`;
        break;
      } catch {}
    }

    // Biome
    try {
      const biome = await Bun.file('biome.json').text();
      context += `### Biome (biome.json)\n\`\`\`\n${biome.substring(0, 800)}\n\`\`\`\n\n`;
    } catch {}

    // EditorConfig
    try {
      const editorConfig = await Bun.file('.editorconfig').text();
      context += `### EditorConfig\n\`\`\`\n${editorConfig}\n\`\`\`\n\n`;
    } catch {}

    // TypeScript config
    try {
      const tsconfig = await Bun.file('tsconfig.json').text();
      context += `### TypeScript Config\n\`\`\`json\n${tsconfig.substring(0, 1000)}\n\`\`\`\n\n`;
    } catch {}

    // 3. Architecture Analysis
    context += '## Architecture\n\n';

    // Entry points
    context += '### Entry Points\n';
    const entryFiles = ['src/index.ts', 'src/main.ts', 'src/app.ts', 'index.ts', 'main.ts', 'app.ts',
                        'src/index.js', 'src/main.js', 'pages/_app.tsx', 'app/layout.tsx'];
    for (const entry of entryFiles) {
      try {
        const content = await Bun.file(entry).text();
        const lines = content.split('\n').slice(0, 30).join('\n');
        context += `\n**${entry}** (first 30 lines):\n\`\`\`\n${lines}\n\`\`\`\n`;
        break;
      } catch {}
    }

    // Directory structure
    try {
      const result = await Bun.$`find . -maxdepth 2 -type d | grep -v node_modules | grep -v .git | head -30`.text();
      context += `\n### Directory Structure\n\`\`\`\n${result}\`\`\`\n\n`;
    } catch {}

    // 4. Key Configuration Files
    context += '## Key Configurations\n\n';

    // Package.json scripts
    try {
      const pkg = await Bun.file('package.json').json();
      if (pkg.scripts) {
        context += '### NPM Scripts\n```json\n' + JSON.stringify(pkg.scripts, null, 2) + '\n```\n\n';
      }
      // Dependencies overview
      const deps = Object.keys(pkg.dependencies || {}).slice(0, 15);
      const devDeps = Object.keys(pkg.devDependencies || {}).slice(0, 10);
      if (deps.length > 0) context += `### Main Dependencies\n${deps.join(', ')}\n\n`;
      if (devDeps.length > 0) context += `### Dev Dependencies\n${devDeps.join(', ')}\n\n`;
    } catch {}

    // Docker
    try {
      const dockerfile = await Bun.file('Dockerfile').text();
      context += `### Dockerfile\n\`\`\`dockerfile\n${dockerfile.substring(0, 600)}\n\`\`\`\n\n`;
    } catch {}

    // Docker Compose
    try {
      const compose = await Bun.file('docker-compose.yml').text();
      context += `### Docker Compose\n\`\`\`yaml\n${compose.substring(0, 600)}\n\`\`\`\n\n`;
    } catch {}

    // Environment example
    try {
      const envExample = await Bun.file('.env.example').text();
      context += `### Environment Variables (.env.example)\n\`\`\`\n${envExample}\n\`\`\`\n\n`;
    } catch {}

    // 5. Git conventions
    context += '## Git & Conventions\n\n';
    try {
      const gitignore = await Bun.file('.gitignore').text();
      context += `### .gitignore (first 30 lines)\n\`\`\`\n${gitignore.split('\n').slice(0, 30).join('\n')}\n\`\`\`\n\n`;
    } catch {}

    // Existing context files
    for (const ctxFile of ['CLAUDE.md', 'GROK.md', 'SLASHBOT.md', 'CONTRIBUTING.md']) {
      try {
        const content = await Bun.file(ctxFile).text();
        context += `### ${ctxFile}\n\`\`\`markdown\n${content.substring(0, 1500)}\n\`\`\`\n\n`;
      } catch {}
    }

    // 6. Key API files (full content for documentation)
    context += '## Key API Files\n\n';
    const apiFiles = ['src/api/grok.ts', 'src/api/index.ts', 'src/index.ts'];
    for (const apiFile of apiFiles) {
      try {
        const content = await Bun.file(apiFile).text();
        context += `### ${apiFile}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch {}
    }

    // 7. Code Patterns (sample source files)
    context += '## Code Patterns (samples)\n\n';
    try {
      const files = await Bun.$`find src -name "*.ts" -o -name "*.tsx" 2>/dev/null | head -5`.text();
      const fileList = files.trim().split('\n').filter(f => f && !apiFiles.includes(f));
      for (const file of fileList.slice(0, 3)) {
        try {
          const content = await Bun.file(file).text();
          const sample = content.split('\n').slice(0, 40).join('\n');
          context += `### ${file}\n\`\`\`typescript\n${sample}\n\`\`\`\n\n`;
        } catch {}
      }
    } catch {}

    // 8. Documentation generation instructions
    context += `## Documentation Task

Based on the analysis above, generate/update **GROK.md** if src/api/grok.ts exists:
- Configuration options
- Usage examples
- Features (streaming, vision, agentic loop, etc.)
- Available methods
- Environment variables

Use <create path="GROK.md">content</create> to generate the file.
Analyze the actual source code to extract accurate information.
Be concise and focus on practical usage.
`;

    return context;
  }
});

export { skills };

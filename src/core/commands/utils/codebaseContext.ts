/**
 * Codebase Context Gathering for /init command
 * Analyzes project structure, configs, and source files
 */

import * as path from 'path';

/**
 * Gather comprehensive codebase context for AI analysis
 * Used by /init to generate GROK.md documentation
 */
export async function gatherCodebaseContext(): Promise<string> {
  let context = '# Comprehensive Codebase Analysis\n\n';
  const cwd = process.cwd();
  const folderName = path.basename(cwd);

  context += `**Folder:** \`${folderName}\`\n`;
  context += `**Path:** \`${cwd}\`\n\n`;

  // 1. Project basics with full package.json analysis
  context += '## Project Identity\n\n';
  try {
    const pkg = await Bun.file('package.json').json();
    context += `### package.json (full)\n\`\`\`json\n${JSON.stringify(pkg, null, 2)}\n\`\`\`\n\n`;
  } catch {
    context += '_No package.json found_\n\n';
  }

  // Check for other package managers
  for (const lockFile of [
    'bun.lockb',
    'bun.lock',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
  ]) {
    try {
      await Bun.file(lockFile).text();
      context += `**Lock file:** ${lockFile}\n`;
      break;
    } catch {}
  }
  context += '\n';

  // 2. Language Detection - analyze file extensions
  context += '## Languages & Frameworks\n\n';
  try {
    const extensions =
      await Bun.$`find . -type f -name "*.*" ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/.next/*" ! -path "*/build/*" 2>/dev/null | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -20`.text();
    context += `### File Extensions (by count)\n\`\`\`\n${extensions}\`\`\`\n\n`;
  } catch {}

  // 3. Complete Directory Structure
  context += '## Directory Structure\n\n';
  try {
    const tree =
      await Bun.$`find . -type d ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/.next/*" | head -50`.text();
    context += `\`\`\`\n${tree}\`\`\`\n\n`;
  } catch {}

  // List all files in src/ or main directories
  try {
    const srcFiles = await Bun.$`find src -type f 2>/dev/null | head -100`.text();
    if (srcFiles.trim()) {
      context += `### Source Files (src/)\n\`\`\`\n${srcFiles}\`\`\`\n\n`;
    }
  } catch {}

  try {
    const appFiles = await Bun.$`find app -type f 2>/dev/null | head -50`.text();
    if (appFiles.trim()) {
      context += `### App Files (app/)\n\`\`\`\n${appFiles}\`\`\`\n\n`;
    }
  } catch {}

  try {
    const libFiles = await Bun.$`find lib -type f 2>/dev/null | head -50`.text();
    if (libFiles.trim()) {
      context += `### Library Files (lib/)\n\`\`\`\n${libFiles}\`\`\`\n\n`;
    }
  } catch {}

  // 4. Code Styling & Formatting - FULL configs
  context += '## Code Style & Formatting\n\n';

  // ESLint - full config
  const eslintConfigs = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
  ];
  for (const config of eslintConfigs) {
    try {
      const content = await Bun.file(config).text();
      context += `### ESLint (${config})\n\`\`\`\n${content}\n\`\`\`\n\n`;
      break;
    } catch {}
  }

  // Prettier - full config
  const prettierConfigs = [
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.json',
    '.prettierrc.yml',
    'prettier.config.js',
    'prettier.config.mjs',
  ];
  for (const config of prettierConfigs) {
    try {
      const content = await Bun.file(config).text();
      context += `### Prettier (${config})\n\`\`\`\n${content}\n\`\`\`\n\n`;
      break;
    } catch {}
  }

  // Biome
  try {
    const biome = await Bun.file('biome.json').text();
    context += `### Biome (biome.json)\n\`\`\`json\n${biome}\n\`\`\`\n\n`;
  } catch {}

  // EditorConfig
  try {
    const editorConfig = await Bun.file('.editorconfig').text();
    context += `### EditorConfig\n\`\`\`\n${editorConfig}\n\`\`\`\n\n`;
  } catch {}

  // 5. TypeScript Configuration - full
  try {
    const tsconfig = await Bun.file('tsconfig.json').text();
    context += `### TypeScript (tsconfig.json)\n\`\`\`json\n${tsconfig}\n\`\`\`\n\n`;
  } catch {}

  // 6. Build & Bundler configs
  context += '## Build & Bundler Configuration\n\n';

  const buildConfigs = [
    { name: 'vite.config.ts', lang: 'typescript' },
    { name: 'vite.config.js', lang: 'javascript' },
    { name: 'webpack.config.js', lang: 'javascript' },
    { name: 'rollup.config.js', lang: 'javascript' },
    { name: 'next.config.js', lang: 'javascript' },
    { name: 'next.config.mjs', lang: 'javascript' },
    { name: 'nuxt.config.ts', lang: 'typescript' },
    { name: 'astro.config.mjs', lang: 'javascript' },
    { name: 'svelte.config.js', lang: 'javascript' },
    { name: 'remix.config.js', lang: 'javascript' },
    { name: 'turbo.json', lang: 'json' },
  ];
  for (const cfg of buildConfigs) {
    try {
      const content = await Bun.file(cfg.name).text();
      context += `### ${cfg.name}\n\`\`\`${cfg.lang}\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 7. Testing Configuration
  context += '## Testing Configuration\n\n';
  const testConfigs = [
    { name: 'jest.config.js', lang: 'javascript' },
    { name: 'jest.config.ts', lang: 'typescript' },
    { name: 'vitest.config.ts', lang: 'typescript' },
    { name: 'playwright.config.ts', lang: 'typescript' },
    { name: 'cypress.config.ts', lang: 'typescript' },
  ];
  for (const cfg of testConfigs) {
    try {
      const content = await Bun.file(cfg.name).text();
      context += `### ${cfg.name}\n\`\`\`${cfg.lang}\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 8. Docker & Deployment
  context += '## Docker & Deployment\n\n';
  try {
    const dockerfile = await Bun.file('Dockerfile').text();
    context += `### Dockerfile\n\`\`\`dockerfile\n${dockerfile}\n\`\`\`\n\n`;
  } catch {}
  try {
    const compose = await Bun.file('docker-compose.yml').text();
    context += `### docker-compose.yml\n\`\`\`yaml\n${compose}\n\`\`\`\n\n`;
  } catch {}
  try {
    const compose2 = await Bun.file('docker-compose.yaml').text();
    context += `### docker-compose.yaml\n\`\`\`yaml\n${compose2}\n\`\`\`\n\n`;
  } catch {}

  // 9. Environment Variables
  context += '## Environment Variables\n\n';
  for (const envFile of ['.env.example', '.env.sample', '.env.template', '.env.local.example']) {
    try {
      const content = await Bun.file(envFile).text();
      context += `### ${envFile}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 10. Git Configuration
  context += '## Git & Repository\n\n';
  try {
    const gitignore = await Bun.file('.gitignore').text();
    context += `### .gitignore\n\`\`\`\n${gitignore}\n\`\`\`\n\n`;
  } catch {}

  // Recent commits
  try {
    const commits = await Bun.$`git log --oneline -20 2>/dev/null`.text();
    if (commits.trim()) {
      context += `### Recent Commits\n\`\`\`\n${commits}\`\`\`\n\n`;
    }
  } catch {}

  // 11. Existing Documentation
  context += '## Existing Documentation\n\n';
  const docFiles = [
    'README.md',
    'CLAUDE.md',
    'GROK.md',
    'SLASHBOT.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'docs/README.md',
  ];
  for (const docFile of docFiles) {
    try {
      const content = await Bun.file(docFile).text();
      context += `### ${docFile}\n\`\`\`markdown\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 12. Entry Points - FULL content
  context += '## Entry Points (full source)\n\n';
  const entryFiles = [
    'src/index.ts',
    'src/main.ts',
    'src/app.ts',
    'index.ts',
    'main.ts',
    'app.ts',
    'src/index.js',
    'src/main.js',
    'pages/_app.tsx',
    'app/layout.tsx',
    'app/page.tsx',
  ];
  for (const entry of entryFiles) {
    try {
      const content = await Bun.file(entry).text();
      context += `### ${entry}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // 13. Core Source Files - read more files for pattern analysis
  context += '## Core Source Files\n\n';
  try {
    // Get all TypeScript/JavaScript files, prioritize by importance
    const importantPatterns = [
      'api',
      'service',
      'util',
      'helper',
      'config',
      'types',
      'model',
      'schema',
      'route',
      'controller',
      'handler',
      'middleware',
    ];

    for (const pattern of importantPatterns) {
      const files =
        await Bun.$`find src -type f \( -name "*${pattern}*.ts" -o -name "*${pattern}*.tsx" -o -name "*${pattern}*.js" \) 2>/dev/null | head -3`.text();
      const fileList = files
        .trim()
        .split('\n')
        .filter(f => f);

      for (const file of fileList) {
        try {
          const content = await Bun.file(file).text();
          context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
        } catch {}
      }
    }
  } catch {}

  // 14. Sample of other source files for patterns
  context += '## Code Samples (patterns)\n\n';
  try {
    const allFiles =
      await Bun.$`find src -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null | shuf | head -5`.text();
    const fileList = allFiles
      .trim()
      .split('\n')
      .filter(f => f);

    for (const file of fileList) {
      try {
        const content = await Bun.file(file).text();
        context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch {}
    }
  } catch {}

  // 15. Database & ORM
  context += '## Database & ORM\n\n';
  const dbConfigs = [
    { name: 'prisma/schema.prisma', lang: 'prisma' },
    { name: 'drizzle.config.ts', lang: 'typescript' },
    { name: 'knexfile.js', lang: 'javascript' },
    { name: 'ormconfig.json', lang: 'json' },
    { name: 'typeorm.config.ts', lang: 'typescript' },
  ];
  for (const cfg of dbConfigs) {
    try {
      const content = await Bun.file(cfg.name).text();
      context += `### ${cfg.name}\n\`\`\`${cfg.lang}\n${content}\n\`\`\`\n\n`;
    } catch {}
  }

  // Migrations folder
  try {
    const migrations =
      await Bun.$`ls -la prisma/migrations 2>/dev/null || ls -la migrations 2>/dev/null || ls -la db/migrations 2>/dev/null`.text();
    if (migrations.trim()) {
      context += `### Migrations\n\`\`\`\n${migrations}\`\`\`\n\n`;
    }
  } catch {}

  // 16. API Routes
  context += '## API Routes\n\n';
  try {
    const apiRoutes =
      await Bun.$`find . -type f \( -path "*/api/*" -o -path "*/routes/*" -o -path "*/controllers/*" \) \( -name "*.ts" -o -name "*.js" \) ! -path "*/node_modules/*" 2>/dev/null | head -10`.text();
    const routeFiles = apiRoutes
      .trim()
      .split('\n')
      .filter(f => f);

    for (const file of routeFiles) {
      try {
        const content = await Bun.file(file).text();
        context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch {}
    }
  } catch {}

  // 17. Components (for frontend projects)
  context += '## UI Components\n\n';
  try {
    const components =
      await Bun.$`find . -type f \( -path "*/components/*" \) \( -name "*.tsx" -o -name "*.vue" -o -name "*.svelte" \) ! -path "*/node_modules/*" 2>/dev/null | head -5`.text();
    const componentFiles = components
      .trim()
      .split('\n')
      .filter(f => f);

    for (const file of componentFiles) {
      try {
        const content = await Bun.file(file).text();
        context += `### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch {}
    }
  } catch {}

  return context;
}

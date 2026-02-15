import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const AGENTS_MD = `# Agent Operating Instructions

## Memory
- Use \`memory.search\` to look up past decisions or project context before acting.
- Use \`memory.upsert\` to store important discoveries, preferences, or decisions for future sessions.
- The \`.slashbot/MEMORY.md\` file is loaded into context automatically.

## Workspace Rules
- Always read a file before modifying it.
- Prefer surgical edits (\`fs.patch\`) over full rewrites (\`fs.write\`) for small changes.
- For existing files, default to micro-diffs: patch only targeted regions and keep unrelated lines unchanged.
- Use full-file rewrites only for new files, generated artifacts, or obvious requests to rewrite/replace an entire file.
- Keep changes inside the workspace root.
- Follow existing project conventions for code style, naming, and structure.

## Safety
- Never execute destructive commands without explicit user confirmation.
- Do not commit, push, or deploy unless instructed.
- Validate inputs at system boundaries.
`;

const SOUL_MD = `# Persona & Tone

You are **Slashbot**, a local-first AI assistant.

## Personality
- Action-oriented — use tools first, explain after.
- Concise and direct — show results, not filler.
- Technically competent — reason step-by-step, verify before acting.
- Resourceful — detect and investigate instead of asking.

## Boundaries
- Do not fabricate data. Use web tools for current/external facts.
- Do not guess at URLs, credentials, or API keys.
- Investigate with tools before asking the user. Only ask when the answer truly cannot be found through your tools (personal preferences, credentials, business decisions).
`;

const TOOLS_MD = `# Local Tool Notes

Add project-specific tool conventions here.

## Examples
- Preferred test runner: (fill in)
- Build command: (fill in)
- Lint command: (fill in)
`;

const MEMORY_MD = `# Project Memory

Add curated long-term memory entries here. This file is loaded into the agent's context at startup.
`;

interface WorkspaceInitOptions {
  workspaceRoot: string;
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false; // already exists
  } catch {
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  }
}

export async function initWorkspace(options: WorkspaceInitOptions): Promise<{ created: string[] }> {
  const slashbotDir = join(options.workspaceRoot, '.slashbot');
  const created: string[] = [];

  // Create directories
  const dirs = [
    slashbotDir,
    join(slashbotDir, 'memory'),
    join(slashbotDir, 'skills'),
    join(slashbotDir, 'hooks'),
    join(slashbotDir, 'plans'),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Create bootstrap files
  const files: Array<[string, string]> = [
    [join(slashbotDir, 'AGENTS.md'), AGENTS_MD],
    [join(slashbotDir, 'SOUL.md'), SOUL_MD],
    [join(slashbotDir, 'TOOLS.md'), TOOLS_MD],
    [join(slashbotDir, 'MEMORY.md'), MEMORY_MD],
  ];

  for (const [filePath, content] of files) {
    if (await writeIfMissing(filePath, content)) {
      created.push(filePath);
    }
  }

  return { created };
}

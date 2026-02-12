import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { createCodeEditor } from './CodeEditor';

vi.mock('../../../core/ui', () => ({
  display: {
    errorText: vi.fn(),
    muted: vi.fn(),
    successText: vi.fn(),
  },
}));

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('CodeEditor search helpers', () => {
  it('glob resolves absolute path inputs and matches TypeScript/JSON files', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'slashbot-code-editor-'));
    cleanupDirs.push(workDir);

    await mkdir(path.join(workDir, 'src'), { recursive: true });
    await writeFile(path.join(workDir, 'src', 'index.ts'), 'export const answer = 42;\n', 'utf8');
    await writeFile(path.join(workDir, 'package.json'), '{"name":"demo"}\n', 'utf8');

    const editor = createCodeEditor(workDir);
    const tsFiles = await editor.glob('**/*.ts', workDir);
    const jsonFiles = await editor.glob('**/*.json', workDir);

    expect(tsFiles).toContain('src/index.ts');
    expect(jsonFiles).toContain('package.json');
  });

  it('glob accepts quoted absolute paths', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'slashbot-code-editor-quoted-'));
    cleanupDirs.push(workDir);

    await mkdir(path.join(workDir, 'src'), { recursive: true });
    await writeFile(path.join(workDir, 'src', 'main.ts'), 'export {};\n', 'utf8');

    const editor = createCodeEditor(workDir);
    const quotedPath = `"${workDir}"`;
    const matches = await editor.glob('**/*.ts', quotedPath);

    expect(matches).toContain('src/main.ts');
  });

  it('glob and grep work on an absolute path outside the workspace', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'slashbot-code-editor-work-'));
    const externalDir = await mkdtemp(path.join(os.tmpdir(), 'slashbot-code-editor-external-'));
    cleanupDirs.push(workDir, externalDir);

    const apiDir = path.join(externalDir, 'api');
    await mkdir(apiDir, { recursive: true });
    await writeFile(path.join(apiDir, 'service.ts'), 'const FEATURE_FLAG = true;\n', 'utf8');

    const editor = createCodeEditor(workDir);
    const absoluteTsPath = path.join(apiDir, 'service.ts').split(path.sep).join('/');

    const globMatches = await editor.glob('**/*.ts', externalDir);
    const grepMatches = await editor.grep('FEATURE_FLAG', undefined, {
      path: externalDir,
      glob: '**/*.ts',
    });

    expect(globMatches).toContain(absoluteTsPath);
    expect(grepMatches.some(result => result.file === absoluteTsPath && result.line === 1)).toBe(true);
  });
});

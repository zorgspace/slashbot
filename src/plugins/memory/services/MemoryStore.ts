import path from 'path';
import { readdir, stat } from 'fs/promises';

export type MemoryHit = { path: string; line: number; text: string; score: number };

type MemoryChunk = {
  path: string;
  line: number;
  text: string;
  heading: string;
  fingerprint: string;
};

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9_]+/)
    .filter(Boolean)
    .slice(0, 32);
}

function makeFingerprint(p: string, line: number, text: string): string {
  return `${p}:${line}:${normalizeText(text).slice(0, 180)}`;
}

export class MemoryStore {
  private indexedAt: number | null = null;
  private cache = new Map<string, { mtimeMs: number; chunks: MemoryChunk[] }>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(private readonly workDir: string) {}

  private async listMemoryFiles(): Promise<string[]> {
    const files: string[] = [];
    const rootMemory = path.join(this.workDir, 'MEMORY.md');
    const rootAltMemory = path.join(this.workDir, 'memory.md');
    if (await Bun.file(rootMemory).exists()) files.push('MEMORY.md');
    if (await Bun.file(rootAltMemory).exists()) files.push('memory.md');

    const memoryDir = path.join(this.workDir, 'memory');
    try {
      const entries = await readdir(memoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          files.push(`memory/${entry.name}`);
        }
      }
    } catch {
      // ignore missing directory
    }
    return files.sort();
  }

  private parseChunks(relPath: string, content: string): MemoryChunk[] {
    const lines = content.split('\n');
    const chunks: MemoryChunk[] = [];
    let heading = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        heading = line.replace(/^#+\s*/, '').trim();
        continue;
      }
      chunks.push({
        path: relPath,
        line: i + 1,
        text: line,
        heading,
        fingerprint: makeFingerprint(relPath, i + 1, line),
      });
    }
    return chunks;
  }

  private async loadChunksForFile(relPath: string): Promise<MemoryChunk[]> {
    const abs = path.join(this.workDir, relPath);
    const fileStat = await stat(abs).catch(() => null);
    if (!fileStat) return [];
    const cached = this.cache.get(relPath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      this.cacheHits += 1;
      return cached.chunks;
    }
    this.cacheMisses += 1;
    const text = await Bun.file(abs).text().catch(() => '');
    if (!text) {
      this.cache.set(relPath, { mtimeMs: fileStat.mtimeMs, chunks: [] });
      return [];
    }
    const chunks = this.parseChunks(relPath, text);
    this.cache.set(relPath, { mtimeMs: fileStat.mtimeMs, chunks });
    return chunks;
  }

  async search(query: string, limit: number): Promise<MemoryHit[]> {
    const q = query.trim();
    if (!q) return [];
    const qNorm = normalizeText(q);
    const terms = tokenize(q);
    const files = await this.listMemoryFiles();
    const scored = new Map<string, MemoryHit>();

    for (const relPath of files) {
      const chunks = await this.loadChunksForFile(relPath);
      for (const chunk of chunks) {
        const textNorm = normalizeText(chunk.text);
        let score = 0;
        if (textNorm.includes(qNorm)) score += 5;
        if (chunk.heading && normalizeText(chunk.heading).includes(qNorm)) score += 2;
        for (const term of terms) {
          if (term.length < 2) continue;
          if (textNorm.includes(term)) score += 1;
        }
        if (score <= 0) continue;
        const prev = scored.get(chunk.fingerprint);
        if (!prev || score > prev.score) {
          scored.set(chunk.fingerprint, {
            path: chunk.path,
            line: chunk.line,
            text: chunk.text,
            score,
          });
        }
      }
    }

    this.indexedAt = Date.now();

    return [...scored.values()]
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line)
      .slice(0, Math.max(1, Math.min(200, limit)));
  }

  async get(pathRel: string, startLine?: number, endLine?: number): Promise<string | null> {
    const normalized = pathRel.replace(/\\/g, '/').replace(/^\.?\//, '');
    const lower = normalized.toLowerCase();
    if (!(lower === 'memory.md' || lower.startsWith('memory/'))) {
      return null;
    }
    const absolute = path.join(this.workDir, normalized);
    const file = Bun.file(absolute);
    if (!(await file.exists())) return null;
    const text = await file.text();
    const lines = text.split('\n');
    const start = Math.max(1, Number(startLine || 1));
    const end = Math.max(start, Number(endLine || start + 49));
    const slice = lines.slice(start - 1, end);
    const width = String(end).length;
    return slice.map((line, idx) => `${String(start + idx).padStart(width, ' ')}|${line}`).join('\n');
  }

  async upsert(entry: { text: string; tags?: string[]; file?: string }): Promise<{ path: string; line: number }> {
    const target = (entry.file || 'memory/notes.md').replace(/\\/g, '/').replace(/^\.?\//, '');
    const lower = target.toLowerCase();
    if (!(lower === 'memory.md' || lower.startsWith('memory/'))) {
      throw new Error('memory_upsert only allows MEMORY.md and memory/*.md');
    }
    const absolute = path.join(this.workDir, target);
    const ts = new Date().toISOString();
    const tags = (entry.tags || []).filter(Boolean).map(t => t.trim()).filter(Boolean);
    const line = `- [${ts}] ${entry.text.trim()}${tags.length > 0 ? ` [tags: ${tags.join(', ')}]` : ''}`;
    const file = Bun.file(absolute);
    const existing = (await file.exists()) ? await file.text() : '# Memory Notes\n';
    const next = existing.endsWith('\n') ? `${existing}${line}\n` : `${existing}\n${line}\n`;
    await Bun.write(absolute, next);
    this.cache.delete(target);
    const lineNo = next.split('\n').length - 1;
    return { path: target, line: lineNo };
  }

  async stats(): Promise<{
    files: number;
    chunks: number;
    indexedAt: number | null;
    cacheHits: number;
    cacheMisses: number;
  }> {
    const files = await this.listMemoryFiles();
    let chunks = 0;
    for (const relPath of files) {
      chunks += (await this.loadChunksForFile(relPath)).length;
    }
    return {
      files: files.length,
      chunks,
      indexedAt: this.indexedAt,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }
}


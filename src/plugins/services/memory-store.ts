/**
 * @module plugins/services/memory-store
 *
 * Persistent markdown-based memory store with BM25 full-text search.
 * Stores facts, decisions, and preferences in `.slashbot/MEMORY.md` and
 * `.slashbot/memory/*.md` files. Supports daily notes, timestamped upserts,
 * and file-level mtime caching for efficient re-indexing.
 *
 * @see {@link MemoryStore} — Main store class
 * @see {@link MemoryHit} — Search result type
 * @see {@link MemoryUpsertInput} — Upsert input type
 */
import { promises as fs } from 'node:fs';
import { join, relative, resolve } from 'node:path';

interface MemoryChunk {
  path: string;
  line: number;
  text: string;
  heading: string;
  fingerprint: string;
}

/** A single search result returned by {@link MemoryStore.search}. */
export interface MemoryHit {
  /** Relative path of the memory file containing this hit. */
  path: string;
  /** Line number (1-based) within the file. */
  line: number;
  /** The matched line text. */
  text: string;
  /** BM25 relevance score (higher is better). */
  score: number;
}

/** Input for appending a new entry to a memory file via {@link MemoryStore.upsert}. */
export interface MemoryUpsertInput {
  /** The text content to store. */
  text: string;
  /** Optional tags for categorization. */
  tags?: string[];
  /** Target memory file path (defaults to `memory/notes.md`). */
  file?: string;
}

/** Statistics about the memory store returned by {@link MemoryStore.stats}. */
export interface MemoryStats {
  /** Number of memory files discovered. */
  files: number;
  /** Total number of indexed text chunks across all files. */
  chunks: number;
  /** ISO timestamp of when the stats were computed. */
  indexedAt: string;
}

interface CacheEntry {
  mtime: number;
  chunks: MemoryChunk[];
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 32);
}

function makeFingerprint(path: string, line: number, text: string): string {
  return `${path}:${line}:${normalizeText(text).slice(0, 180)}`;
}

function parseChunks(path: string, content: string): MemoryChunk[] {
  const lines = content.split('\n');
  const chunks: MemoryChunk[] = [];
  let currentHeading = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) {
      currentHeading = line.replace(/^#+\s*/, '').trim();
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    chunks.push({
      path,
      line: i + 1,
      text: trimmed,
      heading: currentHeading,
      fingerprint: makeFingerprint(path, i + 1, trimmed),
    });
  }

  return chunks;
}

/**
 * MemoryStore — persistent markdown-based memory with BM25 full-text search.
 *
 * Stores facts, decisions, and preferences in `.slashbot/MEMORY.md` and
 * `.slashbot/memory/*.md` files. Provides:
 *  - `search(query, limit)` — BM25-scored full-text search across all memory files.
 *  - `get(path, startLine?, endLine?)` — Read a specific memory file with optional line range.
 *  - `upsert({ text, tags?, file? })` — Append a timestamped entry to a memory file.
 *  - `stats()` — Get file count and chunk count.
 *
 * Caches parsed chunks per file (invalidated on mtime change).
 *
 * Used by: Memory plugin.
 */
export class MemoryStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly baseDir: string;

  constructor(workspaceRoot: string) {
    this.baseDir = join(workspaceRoot, '.slashbot');
  }

  private memoryRoot(): string {
    return this.baseDir;
  }

  private async listFiles(): Promise<string[]> {
    const root = this.memoryRoot();
    const files: string[] = [];

    for (const name of ['MEMORY.md', 'memory.md']) {
      try {
        await fs.access(join(root, name));
        files.push(name);
      } catch { /* not found */ }
    }

    try {
      const memDir = join(root, 'memory');
      const entries = await fs.readdir(memDir);
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          files.push(join('memory', entry));
        }
      }
    } catch { /* directory not found */ }

    return files;
  }

  private async loadFile(relPath: string): Promise<MemoryChunk[]> {
    const fullPath = join(this.memoryRoot(), relPath);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      this.cache.delete(relPath);
      return [];
    }

    const cached = this.cache.get(relPath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.chunks;
    }

    const content = await fs.readFile(fullPath, 'utf8');
    const chunks = parseChunks(relPath, content);
    this.cache.set(relPath, { mtime: stat.mtimeMs, chunks });
    return chunks;
  }

  private async allChunks(): Promise<MemoryChunk[]> {
    const files = await this.listFiles();
    const allChunks: MemoryChunk[] = [];
    for (const file of files) {
      const chunks = await this.loadFile(file);
      allChunks.push(...chunks);
    }
    return allChunks;
  }

  /**
   * Full-text BM25 search across all memory files.
   * @param query - The search query string.
   * @param limit - Maximum number of results to return (default 10).
   * @returns Scored search results sorted by relevance.
   */
  async search(query: string, limit = 10): Promise<MemoryHit[]> {
    const chunks = await this.allChunks();
    if (chunks.length === 0) return [];

    const queryTerms = tokenize(query);
    const normalizedQuery = normalizeText(query);
    if (queryTerms.length === 0) return [];

    // BM25 parameters
    const k1 = 1.5;
    const b = 0.75;

    // Precompute document lengths and average
    const docLengths = chunks.map((c) => tokenize(c.text).length);
    const avgDl = docLengths.reduce((sum, l) => sum + l, 0) / chunks.length;

    // Compute IDF for each query term: log((N - n + 0.5) / (n + 0.5) + 1)
    const N = chunks.length;
    const idf = new Map<string, number>();
    for (const term of queryTerms) {
      let df = 0;
      for (const chunk of chunks) {
        if (normalizeText(chunk.text).includes(term)) df++;
      }
      idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }

    const scored: Array<MemoryChunk & { score: number }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const normalizedText = normalizeText(chunk.text);
      const docTokens = tokenize(chunk.text);
      const dl = docLengths[i];

      // BM25 score
      let bm25Score = 0;
      for (const term of queryTerms) {
        const tf = docTokens.filter((t) => t === term).length;
        if (tf === 0) continue;
        const termIdf = idf.get(term) ?? 0;
        bm25Score += termIdf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl))));
      }

      if (bm25Score <= 0) continue;

      // Tie-breaker bonuses on top of BM25
      if (normalizedText.includes(normalizedQuery)) {
        bm25Score += 5;
      }
      if (normalizeText(chunk.heading).includes(normalizedQuery)) {
        bm25Score += 2;
      }

      scored.push({ ...chunk, score: bm25Score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.line - b.line;
    });

    return scored.slice(0, limit).map((c) => ({
      path: c.path,
      line: c.line,
      text: c.text,
      score: c.score,
    }));
  }

  /**
   * Read a specific memory file with optional line range.
   * @param pathRel - Relative path within the memory directory.
   * @param startLine - Start line number (1-based, inclusive).
   * @param endLine - End line number (inclusive).
   * @returns Numbered lines of the file content.
   * @throws If the path escapes the memory directory.
   */
  async get(pathRel: string, startLine?: number, endLine?: number): Promise<string> {
    const safePath = resolve(this.memoryRoot(), pathRel);
    const rel = relative(this.memoryRoot(), safePath);
    if (rel.startsWith('..')) {
      throw new Error('Path escapes memory directory');
    }

    const content = await fs.readFile(safePath, 'utf8');
    const lines = content.split('\n');

    const start = Math.max(0, (startLine ?? 1) - 1);
    const end = endLine ?? lines.length;
    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join('\n');
  }

  /**
   * Append a timestamped entry to a memory file.
   * @param entry - The text, tags, and optional target file.
   * @returns The file path and line number where the entry was written.
   */
  async upsert(entry: MemoryUpsertInput): Promise<{ path: string; line: number }> {
    const fileName = entry.file ?? join('memory', 'notes.md');
    const fullPath = join(this.memoryRoot(), fileName);

    await fs.mkdir(join(this.memoryRoot(), 'memory'), { recursive: true });

    const tagSuffix = entry.tags && entry.tags.length > 0 ? ` [tags: ${entry.tags.join(', ')}]` : '';
    const line = `- [${new Date().toISOString()}] ${entry.text}${tagSuffix}\n`;

    let lineNumber: number;
    try {
      const existing = await fs.readFile(fullPath, 'utf8');
      lineNumber = existing.split('\n').length;
      await fs.appendFile(fullPath, line, 'utf8');
    } catch {
      await fs.writeFile(fullPath, line, 'utf8');
      lineNumber = 1;
    }

    this.cache.delete(fileName);
    return { path: fileName, line: lineNumber };
  }

  /**
   * Add a quick timestamped note to today's daily notes file (YYYYMM/YYYYMMDD.md).
   * @param text - The note content.
   * @returns The relative path of the daily notes file.
   */
  async appendToday(text: string): Promise<{ path: string }> {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const yyyymmdd = `${yyyymm}${String(now.getDate()).padStart(2, '0')}`;
    const dirPath = join(this.baseDir, 'memory', yyyymm);
    const filePath = join(dirPath, `${yyyymmdd}.md`);
    const relPath = join('memory', yyyymm, `${yyyymmdd}.md`);

    await fs.mkdir(dirPath, { recursive: true });

    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const line = `- [${hhmm}] ${text}\n`;

    try {
      await fs.appendFile(filePath, line, 'utf8');
    } catch {
      await fs.writeFile(filePath, `# Daily Notes ${yyyymmdd}\n\n${line}`, 'utf8');
    }

    this.cache.delete(relPath);
    return { path: relPath };
  }

  /**
   * Get concatenated daily notes from the last N days.
   * @param days - Number of days to look back (default 3).
   * @returns Formatted markdown string of recent daily notes.
   */
  async getRecentNotes(days = 3): Promise<string> {
    const results: string[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      const yyyymmdd = `${yyyymm}${String(d.getDate()).padStart(2, '0')}`;
      const filePath = join(this.baseDir, 'memory', yyyymm, `${yyyymmdd}.md`);

      try {
        const content = await fs.readFile(filePath, 'utf8');
        results.push(`## ${yyyymmdd}\n${content.trim()}`);
      } catch {
        // No notes for this day
      }
    }

    return results.join('\n\n');
  }

  /**
   * Get memory store statistics: file count, chunk count, and index timestamp.
   * @returns Memory store statistics.
   */
  async stats(): Promise<MemoryStats> {
    const files = await this.listFiles();
    const chunks = await this.allChunks();
    return {
      files: files.length,
      chunks: chunks.length,
      indexedAt: new Date().toISOString(),
    };
  }
}

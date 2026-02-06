/**
 * Explore Action Handler - Parallel multi-worker code search
 *
 * Launches multiple search workers in parallel to quickly find relevant code.
 * Much faster than sequential file-by-file searches.
 */

import type { ActionResult, ActionHandlers, GrepOptions } from '../../core/actions/types';
import type { ExploreAction } from './types';
import { display } from '../../core/ui';

interface SearchWorker {
  name: string;
  pattern: string;
  options: GrepOptions;
}

/**
 * Decode HTML entities that LLM might produce
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Check if query looks like a regex (has special chars that user wants as regex)
 */
function isRegexQuery(query: string): boolean {
  // If has unescaped | or .* or .+ or () - treat as regex
  return /[|]|\.\*|\.\+|\([^)]+\)/.test(query);
}

/**
 * Generate search workers based on query and depth
 */
function generateWorkers(
  query: string,
  basePath: string,
  depth: 'quick' | 'medium' | 'deep' | 'comprehensive',
): SearchWorker[] {
  const workers: SearchWorker[] = [];

  // Decode HTML entities first
  const decodedQuery = decodeHtmlEntities(query);

  // If query looks like a regex, use it as-is. Otherwise escape special chars.
  const searchPattern = isRegexQuery(decodedQuery)
    ? decodedQuery
    : decodedQuery.replace(/[.*+?^${}()[\]\\]/g, '\\$&');

  // For function/class patterns, we need a simpler version without regex chars
  const simpleQuery = decodedQuery.replace(/[.*+?^${}()|[\]\\]/g, '');

  // Core search patterns
  const patterns = {
    // Main pattern (regex or literal)
    main: searchPattern,
    // Function/method definition (only if query is simple enough)
    funcDef: simpleQuery ? `(function|const|let|var|def|fn|func)\\s+\\w*${simpleQuery}\\w*` : null,
    // Class definition
    classDef: simpleQuery ? `class\\s+\\w*${simpleQuery}\\w*` : null,
    // Import/export
    imports: simpleQuery ? `(import|export|require).*${simpleQuery}` : null,
    // Type/interface
    types: simpleQuery ? `(type|interface)\\s+\\w*${simpleQuery}\\w*` : null,
  };

  // Helper to add worker only if pattern exists
  const addWorker = (name: string, pattern: string | null, opts: GrepOptions) => {
    if (pattern) {
      workers.push({ name, pattern, options: opts });
    }
  };

  // Quick: just main pattern search
  if (depth === 'quick') {
    addWorker('main', patterns.main, {
      path: basePath,
      headLimit: 30,
      lineNumbers: true,
      context: 2,
    });
    addWorker('functions', patterns.funcDef, { path: basePath, headLimit: 15, lineNumbers: true });
  }

  // Medium: add imports, classes, types
  if (depth === 'medium') {
    addWorker('main', patterns.main, {
      path: basePath,
      headLimit: 50,
      lineNumbers: true,
      context: 3,
    });
    addWorker('functions', patterns.funcDef, {
      path: basePath,
      headLimit: 20,
      lineNumbers: true,
      context: 2,
    });
    addWorker('classes', patterns.classDef, {
      path: basePath,
      headLimit: 15,
      lineNumbers: true,
      context: 2,
    });
    addWorker('imports', patterns.imports, { path: basePath, headLimit: 15, lineNumbers: true });
    addWorker('types', patterns.types, {
      path: basePath,
      headLimit: 15,
      lineNumbers: true,
      context: 2,
    });
  }

  // Deep: comprehensive search with more context
  if (depth === 'deep') {
    addWorker('main', patterns.main, {
      path: basePath,
      headLimit: 80,
      lineNumbers: true,
      context: 4,
    });
    addWorker('case-insensitive', patterns.main, {
      path: basePath,
      headLimit: 40,
      lineNumbers: true,
      context: 3,
      caseInsensitive: true,
    });
    addWorker('functions', patterns.funcDef, {
      path: basePath,
      headLimit: 30,
      lineNumbers: true,
      context: 3,
    });
    addWorker('classes', patterns.classDef, {
      path: basePath,
      headLimit: 20,
      lineNumbers: true,
      context: 3,
    });
    addWorker('imports', patterns.imports, { path: basePath, headLimit: 20, lineNumbers: true });
    addWorker('types', patterns.types, {
      path: basePath,
      headLimit: 20,
      lineNumbers: true,
      context: 3,
    });
    addWorker('config-files', patterns.main, {
      path: basePath,
      glob: '*.{json,yaml,yml,toml}',
      headLimit: 15,
      lineNumbers: true,
    });
  }

  // Comprehensive: exhaustive search across all file types and contexts
  if (depth === 'comprehensive') {
    // Core code searches with maximum context
    addWorker('main', patterns.main, {
      path: basePath,
      headLimit: 100,
      lineNumbers: true,
      context: 5,
    });
    addWorker('case-insensitive', patterns.main, {
      path: basePath,
      headLimit: 60,
      lineNumbers: true,
      context: 4,
      caseInsensitive: true,
    });

    // Function and class definitions
    addWorker('functions', patterns.funcDef, {
      path: basePath,
      headLimit: 40,
      lineNumbers: true,
      context: 4,
    });
    addWorker('classes', patterns.classDef, {
      path: basePath,
      headLimit: 30,
      lineNumbers: true,
      context: 4,
    });
    addWorker('methods', simpleQuery ? `(async\\s+)?\\w+\\s*\\([^)]*\\)\\s*{` : null, {
      path: basePath,
      headLimit: 30,
      lineNumbers: true,
      context: 2,
    });

    // Imports and exports
    addWorker('imports', patterns.imports, { path: basePath, headLimit: 25, lineNumbers: true });
    addWorker('exports', simpleQuery ? `(export|module\\.exports).*${simpleQuery}` : null, {
      path: basePath,
      headLimit: 20,
      lineNumbers: true,
    });

    // Types and interfaces
    addWorker('types', patterns.types, {
      path: basePath,
      headLimit: 25,
      lineNumbers: true,
      context: 3,
    });
    addWorker('enums', simpleQuery ? `enum\\s+\\w*${simpleQuery}\\w*` : null, {
      path: basePath,
      headLimit: 15,
      lineNumbers: true,
      context: 3,
    });

    // Comments and documentation
    addWorker('comments', simpleQuery ? `//.*${simpleQuery}|/\\*.*${simpleQuery}` : null, {
      path: basePath,
      headLimit: 20,
      lineNumbers: true,
      context: 1,
    });
    addWorker('todos', `(TODO|FIXME|XXX|HACK).*${searchPattern}`, {
      path: basePath,
      headLimit: 15,
      lineNumbers: true,
      caseInsensitive: true,
    });

    // Error handling
    addWorker(
      'error-handling',
      `(catch|throw|try).*${searchPattern}|${searchPattern}.*(error|Error|exception)`,
      {
        path: basePath,
        headLimit: 20,
        lineNumbers: true,
        context: 2,
        caseInsensitive: true,
      },
    );

    // Config files
    addWorker('config-json', patterns.main, {
      path: basePath,
      glob: '*.{json,package.json,tsconfig.json}',
      headLimit: 20,
      lineNumbers: true,
    });
    addWorker('config-yaml', patterns.main, {
      path: basePath,
      glob: '*.{yaml,yml}',
      headLimit: 15,
      lineNumbers: true,
    });
    addWorker('config-toml', patterns.main, {
      path: basePath,
      glob: '*.toml',
      headLimit: 15,
      lineNumbers: true,
    });

    // Documentation and text files
    addWorker('docs', patterns.main, {
      path: basePath,
      glob: '*.{md,markdown,txt,readme*,changelog*,license*}',
      headLimit: 25,
      lineNumbers: true,
      caseInsensitive: true,
    });

    // Shell and build scripts
    addWorker('scripts', patterns.main, {
      path: basePath,
      glob: '*.{sh,bash,zsh,ps1,Makefile,makefile}',
      headLimit: 20,
      lineNumbers: true,
    });

    // Docker and deployment
    addWorker('docker', patterns.main, {
      path: basePath,
      glob: 'Dockerfile*',
      headLimit: 15,
      lineNumbers: true,
    });
    addWorker('docker-compose', patterns.main, {
      path: basePath,
      glob: 'docker-compose*.{yml,yaml}',
      headLimit: 15,
      lineNumbers: true,
    });

    // Environment and secrets
    addWorker('env-files', patterns.main, {
      path: basePath,
      glob: '.env*',
      headLimit: 10,
      lineNumbers: true,
    });

    // Test files
    addWorker('tests', patterns.main, {
      path: basePath,
      glob: '*.{test,spec}.{js,ts,py,java,go,rs}',
      headLimit: 25,
      lineNumbers: true,
      context: 3,
    });

    // Constants and variables
    addWorker(
      'constants',
      simpleQuery ? `(const|let|var|static|final)\\s+\\w*${simpleQuery}\\w*` : null,
      {
        path: basePath,
        headLimit: 20,
        lineNumbers: true,
        context: 2,
      },
    );
  }

  return workers;
}

/**
 * Execute parallel exploration with multiple grep workers
 */
export async function executeExplore(
  action: ExploreAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onGrep) {
    return {
      action: `Explore: ${action.query}`,
      success: false,
      result: 'Grep handler not available',
      error: 'onGrep handler is required for explore',
    };
  }

  // Support multiple paths separated by space or comma
  const pathInput = action.path || 'src';
  const paths = pathInput.split(/[\s,]+/).filter(p => p.trim());
  const depth = action.depth || 'medium';
  const query = action.query;

  display.tool('Explore', `"${query}" in ${paths.join(', ')} (${depth})`);

  // Generate workers for each path
  const allWorkers: SearchWorker[] = [];
  for (const basePath of paths) {
    allWorkers.push(...generateWorkers(query, basePath.trim(), depth));
  }

  const startTime = Date.now();

  try {
    // Execute all workers in parallel
    const workerPromises = allWorkers.map(async worker => {
      try {
        const result = await handlers.onGrep!(worker.pattern, worker.options);
        return { name: worker.name, result, error: null };
      } catch (error) {
        return { name: worker.name, result: '', error: String(error) };
      }
    });

    const results = await Promise.all(workerPromises);
    const duration = Date.now() - startTime;

    // Combine results, deduplicating and organizing
    const allMatches = new Map<string, Set<string>>(); // file -> lines
    let totalMatches = 0;

    for (const { name, result } of results) {
      if (!result) continue;

      const lines = result.split('\n').filter(l => l.trim());
      for (const line of lines) {
        // Parse file:line format
        const match = line.match(/^([^:]+):(\d+):/);
        if (match) {
          const [, file, lineNum] = match;
          if (!allMatches.has(file)) {
            allMatches.set(file, new Set());
          }
          allMatches.get(file)!.add(line);
          totalMatches++;
        } else if (line.trim()) {
          // Non-file match, add to general
          if (!allMatches.has('_other')) {
            allMatches.set('_other', new Set());
          }
          allMatches.get('_other')!.add(line);
        }
      }
    }

    // Format output grouped by file
    const outputLines: string[] = [];
    const sortedFiles = Array.from(allMatches.keys()).sort();

    for (const file of sortedFiles) {
      if (file === '_other') continue;
      const fileMatches = Array.from(allMatches.get(file)!).slice(0, 10); // Max 10 per file
      outputLines.push(`\n## ${file}`);
      outputLines.push(...fileMatches);
    }

    // Add other matches at end
    if (allMatches.has('_other')) {
      const otherMatches = Array.from(allMatches.get('_other')!).slice(0, 5);
      if (otherMatches.length > 0) {
        outputLines.push('\n## Other');
        outputLines.push(...otherMatches);
      }
    }

    const fileCount = sortedFiles.filter(f => f !== '_other').length;
    const summary = `Found ${totalMatches} matches in ${fileCount} files (${duration}ms, ${allWorkers.length} workers)`;

    display.result(summary);

    const output =
      outputLines.length > 0
        ? `${summary}\n${outputLines.join('\n')}`
        : `No matches found for "${query}" in ${paths.join(', ')}`;

    return {
      action: `Explore: ${query}`,
      success: true,
      result: output,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.error(`Explore failed: ${errorMsg}`);
    return {
      action: `Explore: ${query}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

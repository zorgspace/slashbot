import type { JsonValue, SlashbotPlugin } from '../../plugin-sdk/index.js';
import { MemoryStore } from '../services/memory-store.js'; // also imports EventMap augmentation
import { AssociationGraph } from '../services/association-graph.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { asObject, asString, resolveCommonServices, createLlmAdapter } from '../utils.js';

const PLUGIN_ID = 'slashbot.memory';

/**
 * Memory plugin — persistent markdown-based memory across sessions.
 *
 * Tools:
 *  - `memory.search`    — Full-text search across memory files (with graph expansion).
 *  - `memory.get`       — Read a specific memory file (with optional line range).
 *  - `memory.upsert`    — Store a fact, decision, or preference for future sessions.
 *  - `memory.stats`     — Get memory store statistics (file count, total size).
 *  - `memory.note`      — Add a quick timestamped daily note.
 *  - `memory.related`   — Find concepts connected to a topic via the association graph.
 *  - `memory.associate` — Manually link two concepts in the association graph.
 *  - `memory.path`      — Find shortest path between two concepts in the graph.
 *
 * Services:
 *  - `memory.store` — MemoryStore instance for programmatic access.
 *  - `memory.graph` — AssociationGraph instance for graph operations.
 *
 * Context provider:
 *  - `memory.context` — Injects MEMORY.md content + graph concepts into the system prompt.
 */
export function createMemoryPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Memory',
      version: '0.2.0',
      main: 'bundled',
      description: 'Persistent markdown-based memory with search, graph, and knowledge associations',
    },
    setup: (context) => {
      const workspaceRoot = context.getService<string>('kernel.workspaceRoot') ?? process.cwd();
      const store = new MemoryStore(workspaceRoot);
      const graph = new AssociationGraph(workspaceRoot);

      // Load graph on startup (non-blocking)
      graph.load().catch((err) => {
        context.logger.warn?.('Failed to load association graph', { error: String(err) });
      });

      // Wire EventBus for memory:upserted events and graph extraction
      const services = resolveCommonServices(context);
      const eventBus = services.events;

      if (eventBus) {
        store.setEventBus(eventBus);

        // Subscribe to memory:upserted for auto-extraction
        const llmAdapter = createLlmAdapter(context, services);
        eventBus.subscribe('memory:upserted', (event) => {
          const text = event.payload?.text;
          if (text && typeof text === 'string') {
            // Fire-and-forget extraction
            graph.extractAndMerge(text, llmAdapter).catch(() => {});
          }
        });
      }

      // Register services
      context.registerService({
        id: 'memory.store',
        pluginId: PLUGIN_ID,
        description: 'Markdown-based memory store',
        implementation: store,
      });

      context.registerService({
        id: 'memory.graph',
        pluginId: PLUGIN_ID,
        description: 'Association graph for knowledge relationships',
        implementation: graph,
      });

      // --- Existing tools ---

      context.registerTool({
        id: 'memory.search',
        title: 'Search',
        pluginId: PLUGIN_ID,
        description: 'Search memory for past decisions, project context, or user preferences. Results are automatically enriched with graph-related concepts. Args: { query: string, limit?: number, expand?: boolean }',
        parameters: z.object({
          query: z.string().describe('Search query'),
          limit: z.number().optional().describe('Max results (default 10)'),
          expand: z.boolean().optional().describe('Expand results via graph neighbors (default true)'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const query = asString(input.query, 'query');
            const limit = typeof input.limit === 'number' ? input.limit : 10;
            const expand = input.expand !== false;
            const hits = await store.search(query, limit, expand ? graph : undefined, expand);
            return { ok: true, output: hits as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_SEARCH_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.get',
        title: 'Recall',
        pluginId: PLUGIN_ID,
        description: 'Read a memory file. Args: { path: string, startLine?: number, endLine?: number }',
        parameters: z.object({
          path: z.string().describe('Memory file path'),
          startLine: z.number().optional().describe('Start line number'),
          endLine: z.number().optional().describe('End line number'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const path = asString(input.path, 'path');
            const startLine = typeof input.startLine === 'number' ? input.startLine : undefined;
            const endLine = typeof input.endLine === 'number' ? input.endLine : undefined;
            const content = await store.get(path, startLine, endLine);
            return { ok: true, output: content };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_GET_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.upsert',
        title: 'Remember',
        pluginId: PLUGIN_ID,
        description: 'Store a fact, decision, or preference for future sessions. Use when user says "remember X" or after discovering important project info. Args: { text: string, tags?: string[], file?: string }',
        parameters: z.object({
          text: z.string().describe('Content to remember'),
          tags: z.array(z.string()).optional().describe('Tags for categorization'),
          file: z.string().optional().describe('Target memory file'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const text = asString(input.text, 'text');
            const tags = Array.isArray(input.tags) ? (input.tags as string[]) : undefined;
            const file = typeof input.file === 'string' ? input.file : undefined;
            const result = await store.upsert({ text, tags, file });
            return { ok: true, output: result as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_UPSERT_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.stats',
        title: 'Stats',
        pluginId: PLUGIN_ID,
        description: 'Get memory store statistics. Args: {}',
        parameters: z.object({}),
        execute: async () => {
          try {
            const stats = await store.stats();
            return { ok: true, output: stats as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_STATS_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.note',
        title: 'Note',
        pluginId: PLUGIN_ID,
        description: 'Add a quick timestamped daily note. Appends to today\'s daily notes file (YYYYMM/YYYYMMDD.md). Args: { text: string }',
        parameters: z.object({
          text: z.string().describe('Note content'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const text = asString(input.text, 'text');
            const result = await store.appendToday(text);
            return { ok: true, output: result as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'MEMORY_NOTE_ERROR', message: String(err) } };
          }
        },
      });

      // --- Graph tools ---

      context.registerTool({
        id: 'memory.related',
        title: 'Related',
        pluginId: PLUGIN_ID,
        description: 'Find concepts connected to a topic in the knowledge graph. Returns neighbors with relationship types and weights. Args: { concept: string, depth?: number, type?: string }',
        parameters: z.object({
          concept: z.string().describe('Concept to explore'),
          depth: z.number().min(1).max(3).optional().describe('Traversal depth (1-3, default 1)'),
          type: z.string().optional().describe('Filter by node type'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const concept = asString(input.concept, 'concept');
            const depth = typeof input.depth === 'number' ? input.depth : 1;
            const type = typeof input.type === 'string' ? input.type : undefined;
            const id = graph.slugify(concept);
            const results = graph.neighbors(id, depth, type);
            return { ok: true, output: results as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'GRAPH_RELATED_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.associate',
        title: 'Associate',
        pluginId: PLUGIN_ID,
        description: 'Manually link two concepts in the knowledge graph. Creates nodes if they don\'t exist. Reinforces weight if edge exists. Args: { from: string, to: string, rel: string, fromType?: string, toType?: string }',
        parameters: z.object({
          from: z.string().describe('Source concept'),
          to: z.string().describe('Target concept'),
          rel: z.string().describe('Relationship type (e.g. uses, depends_on, related_to)'),
          fromType: z.string().optional().describe('Type for source node'),
          toType: z.string().optional().describe('Type for target node'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const from = asString(input.from, 'from');
            const to = asString(input.to, 'to');
            const rel = asString(input.rel, 'rel');
            const fromType = typeof input.fromType === 'string' ? input.fromType : undefined;
            const toType = typeof input.toType === 'string' ? input.toType : undefined;

            const fromNode = graph.addNode(from, fromType);
            const toNode = graph.addNode(to, toType);
            const edge = graph.addEdge(fromNode.id, toNode.id, rel);

            return {
              ok: true,
              output: {
                from: fromNode.id,
                to: toNode.id,
                rel: edge.rel,
                weight: edge.weight,
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'GRAPH_ASSOCIATE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'memory.path',
        title: 'Path',
        pluginId: PLUGIN_ID,
        description: 'Find the shortest path between two concepts in the knowledge graph. Uses Dijkstra with edge weights. Args: { from: string, to: string }',
        parameters: z.object({
          from: z.string().describe('Source concept'),
          to: z.string().describe('Target concept'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const from = asString(input.from, 'from');
            const to = asString(input.to, 'to');
            const fromId = graph.slugify(from);
            const toId = graph.slugify(to);
            const path = graph.shortestPath(fromId, toId);
            return { ok: true, output: path as unknown as JsonValue };
          } catch (err) {
            return { ok: false, error: { code: 'GRAPH_PATH_ERROR', message: String(err) } };
          }
        },
      });

      // --- Prompt contribution for graph tools ---

      context.contributePromptSection({
        id: 'memory.graph.tools',
        pluginId: PLUGIN_ID,
        priority: 25,
        content: [
          '## Knowledge Graph Tools',
          '- `memory.associate` — Link two concepts (creates nodes if needed, reinforces existing edges)',
          '- `memory.related` — Explore concepts connected to a topic (configurable depth 1-3)',
          '- `memory.path` — Find shortest path between two concepts in the knowledge graph',
        ].join('\n'),
      });

      // --- Context provider ---

      context.contributeContextProvider({
        id: 'memory.context',
        pluginId: PLUGIN_ID,
        priority: 20,
        provide: async () => {
          const parts: string[] = [];
          try {
            const memPath = join(workspaceRoot, '.slashbot', 'MEMORY.md');
            const content = await fs.readFile(memPath, 'utf8');
            if (content.trim().length > 0) {
              parts.push(`## Memory (MEMORY.md)\n${content.trim()}`);
            }
          } catch {
            // No MEMORY.md
          }
          try {
            const recentNotes = await store.getRecentNotes(3);
            if (recentNotes.trim().length > 0) {
              parts.push(`## Recent Daily Notes\n${recentNotes.trim()}`);
            }
          } catch {
            // No daily notes
          }

          // Graph-based context injection: match conversation-relevant concepts
          try {
            const nodeIds = graph.getAllNodeIds();
            if (nodeIds.length > 0) {
              // Get ChatHistoryStore for recent messages
              const chatHistory = context.getService<{ getRecentMessages?: (n: number) => Array<{ content: string }> }>('chat.history');
              let recentText = '';
              if (chatHistory?.getRecentMessages) {
                const messages = chatHistory.getRecentMessages(5);
                recentText = messages.map(m => m.content).join(' ').toLowerCase();
              }

              if (recentText) {
                const words = recentText.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
                const matchedNodeIds = new Set<string>();

                for (const nodeId of nodeIds) {
                  if (words.some(w => nodeId.includes(w) || w.includes(nodeId))) {
                    matchedNodeIds.add(nodeId);
                  }
                }

                if (matchedNodeIds.size > 0) {
                  const conceptLines: string[] = [];
                  for (const nodeId of matchedNodeIds) {
                    if (conceptLines.length >= 10) break;
                    const neighbors = graph.neighbors(nodeId, 1);
                    const node = graph.getNode(nodeId);
                    if (!node) continue;
                    for (const n of neighbors.slice(0, 3)) {
                      if (conceptLines.length >= 10) break;
                      conceptLines.push(`- ${node.label} (${n.rel} ${n.label})`);
                    }
                  }

                  if (conceptLines.length > 0) {
                    parts.push(`## Associated Concepts\n${conceptLines.join('\n')}`);
                  }
                }
              }
            }
          } catch {
            // Graph context injection failed silently
          }

          return parts.join('\n\n');
        },
      });
    },
  };
}

export { createMemoryPlugin as createPlugin };

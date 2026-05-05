import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { LlmAdapter } from '../../core/agentic/llm/types.js';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  meta?: Record<string, string>;
  created: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  rel: string;
  weight: number;
  created: string;
}

export const BASE_RELATIONS = [
  'related_to', 'uses', 'used_by', 'part_of', 'contains',
  'depends_on', 'enables', 'contradicts', 'replaces',
  'inspired_by', 'chosen_over', 'instance_of',
] as const;

export interface NeighborResult {
  id: string;
  label: string;
  type: string;
  rel: string;
  weight: number;
  direction: 'outgoing' | 'incoming';
}

export interface PathStep {
  node: string;
  rel?: string;
  direction?: 'outgoing' | 'incoming';
}

function edgeKey(from: string, to: string, rel: string): string {
  return `${from}|${to}|${rel}`;
}

export class AssociationGraph {
  private readonly filePath: string;
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge[]>();
  private reverseEdges = new Map<string, GraphEdge[]>();
  private edgeIndex = new Map<string, GraphEdge>();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(workspaceRoot: string) {
    this.filePath = join(workspaceRoot, '.slashbot', 'graph.jsonl');
  }

  slugify(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  }

  async load(): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch {
      return; // File doesn't exist — start with empty graph
    }

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj.t === 'n') {
          const node: GraphNode = {
            id: obj.id,
            label: obj.label,
            type: obj.type ?? 'concept',
            meta: obj.meta,
            created: obj.created,
          };
          this.nodes.set(node.id, node);
        } else if (obj.t === 'e') {
          const edge: GraphEdge = {
            from: obj.from,
            to: obj.to,
            rel: obj.rel,
            weight: obj.weight ?? 0.5,
            created: obj.created,
          };
          this.insertEdge(edge);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  async flush(): Promise<void> {
    const lines: string[] = [];
    for (const node of this.nodes.values()) {
      lines.push(JSON.stringify({ t: 'n', ...node }));
    }
    for (const edgeList of this.edges.values()) {
      for (const edge of edgeList) {
        lines.push(JSON.stringify({ t: 'e', ...edge }));
      }
    }
    const dir = join(this.filePath, '..');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    this.dirty = false;
  }

  addNode(label: string, type?: string, meta?: Record<string, string>): GraphNode {
    const id = this.slugify(label);
    const existing = this.nodes.get(id);
    if (existing) return existing;

    const node: GraphNode = {
      id,
      label,
      type: type ?? 'concept',
      meta,
      created: new Date().toISOString(),
    };
    this.nodes.set(id, node);
    if (this.nodes.size === 5000) {
      console.warn('[AssociationGraph] Graph has reached 5,000 nodes. Consider manual pruning.');
    }
    this.markDirty();
    return node;
  }

  addEdge(fromId: string, toId: string, rel: string): GraphEdge {
    const key = edgeKey(fromId, toId, rel);
    const existing = this.edgeIndex.get(key);
    if (existing) {
      existing.weight = Math.min(1.0, existing.weight + 0.1);
      this.markDirty();
      return existing;
    }

    const edge: GraphEdge = {
      from: fromId,
      to: toId,
      rel,
      weight: 0.5,
      created: new Date().toISOString(),
    };
    this.insertEdge(edge);
    this.markDirty();
    return edge;
  }

  neighbors(nodeId: string, depth = 1, typeFilter?: string): NeighborResult[] {
    if (!this.nodes.has(nodeId)) return [];

    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    const results: NeighborResult[] = [];

    for (let d = 0; d < Math.min(depth, 3); d++) {
      const nextFrontier: string[] = [];
      for (const current of frontier) {
        // Outgoing edges
        for (const edge of this.edges.get(current) ?? []) {
          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            nextFrontier.push(edge.to);
            const node = this.nodes.get(edge.to);
            if (node && (!typeFilter || node.type === typeFilter)) {
              results.push({
                id: node.id,
                label: node.label,
                type: node.type,
                rel: edge.rel,
                weight: edge.weight,
                direction: 'outgoing',
              });
            }
          }
        }
        // Incoming edges
        for (const edge of this.reverseEdges.get(current) ?? []) {
          if (!visited.has(edge.from)) {
            visited.add(edge.from);
            nextFrontier.push(edge.from);
            const node = this.nodes.get(edge.from);
            if (node && (!typeFilter || node.type === typeFilter)) {
              results.push({
                id: node.id,
                label: node.label,
                type: node.type,
                rel: edge.rel,
                weight: edge.weight,
                direction: 'incoming',
              });
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    return results;
  }

  shortestPath(fromId: string, toId: string): PathStep[] {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return [];
    if (fromId === toId) return [{ node: fromId }];

    // Dijkstra with inverted weights (1 - weight as cost)
    const dist = new Map<string, number>();
    const prev = new Map<string, { node: string; rel: string; direction: 'outgoing' | 'incoming' }>();
    const unvisited = new Set<string>(this.nodes.keys());

    dist.set(fromId, 0);

    while (unvisited.size > 0) {
      // Find unvisited node with smallest distance
      let current: string | null = null;
      let minDist = Infinity;
      for (const id of unvisited) {
        const d = dist.get(id) ?? Infinity;
        if (d < minDist) {
          minDist = d;
          current = id;
        }
      }

      if (current === null || minDist === Infinity) break;
      if (current === toId) break;

      unvisited.delete(current);

      // Outgoing edges
      for (const edge of this.edges.get(current) ?? []) {
        if (!unvisited.has(edge.to)) continue;
        const cost = 1 - edge.weight;
        const alt = minDist + cost;
        if (alt < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, { node: current, rel: edge.rel, direction: 'outgoing' });
        }
      }

      // Incoming edges (traverse in reverse)
      for (const edge of this.reverseEdges.get(current) ?? []) {
        if (!unvisited.has(edge.from)) continue;
        const cost = 1 - edge.weight;
        const alt = minDist + cost;
        if (alt < (dist.get(edge.from) ?? Infinity)) {
          dist.set(edge.from, alt);
          prev.set(edge.from, { node: current, rel: edge.rel, direction: 'incoming' });
        }
      }
    }

    // Reconstruct path
    if (!prev.has(toId)) return [];

    const path: PathStep[] = [];
    let step = toId;
    while (step !== fromId) {
      const p = prev.get(step);
      if (!p) return [];
      path.unshift({ node: step, rel: p.rel, direction: p.direction });
      step = p.node;
    }
    path.unshift({ node: fromId });

    return path;
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodeLabels(): string[] {
    return Array.from(this.nodes.values()).map(n => n.label);
  }

  getAllNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  async extractAndMerge(text: string, llmAdapter: LlmAdapter | null): Promise<void> {
    if (!llmAdapter) return;

    try {
      const result = await llmAdapter.complete({
        sessionId: 'graph-extraction',
        agentId: 'graph-extraction',
        messages: [
          {
            role: 'system',
            content: 'Extract concepts and relationships from the given text. Return ONLY a JSON object with this exact structure: { "nodes": [{"label": "...", "type": "concept|tool|decision|person|project|domain"}], "edges": [{"from": "...", "to": "...", "rel": "..."}] }. Use lowercase relation names with underscores (e.g. uses, depends_on, part_of, enables, related_to). Keep it concise — only extract clearly stated concepts and relationships.',
          },
          { role: 'user', content: text },
        ],
        noTools: true,
        maxSteps: 1,
      });

      const responseText = result.text.trim();
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]) as {
        nodes?: Array<{ label: string; type?: string }>;
        edges?: Array<{ from: string; to: string; rel: string }>;
      };

      if (parsed.nodes) {
        for (const n of parsed.nodes) {
          if (n.label) this.addNode(n.label, n.type);
        }
      }

      if (parsed.edges) {
        for (const e of parsed.edges) {
          if (e.from && e.to && e.rel) {
            const fromId = this.slugify(e.from);
            const toId = this.slugify(e.to);
            // Ensure nodes exist
            this.addNode(e.from);
            this.addNode(e.to);
            this.addEdge(fromId, toId, e.rel);
          }
        }
      }
    } catch {
      // Silently ignore extraction errors
    }
  }

  cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private insertEdge(edge: GraphEdge): void {
    const key = edgeKey(edge.from, edge.to, edge.rel);
    this.edgeIndex.set(key, edge);

    const outgoing = this.edges.get(edge.from) ?? [];
    outgoing.push(edge);
    this.edges.set(edge.from, outgoing);

    const incoming = this.reverseEdges.get(edge.to) ?? [];
    incoming.push(edge);
    this.reverseEdges.set(edge.to, incoming);
  }

  private markDirty(): void {
    this.dirty = true;
    this.scheduleDirtyFlush();
  }

  private scheduleDirtyFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flush().catch(() => {});
    }, 500);
  }
}

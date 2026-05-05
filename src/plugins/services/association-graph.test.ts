import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AssociationGraph } from './association-graph.js';
import type { LlmAdapter } from '../../core/agentic/llm/types.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AssociationGraph', () => {
  let graph: AssociationGraph;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'graph-test-'));
    await fs.mkdir(join(tempDir, '.slashbot'), { recursive: true });
    graph = new AssociationGraph(tempDir);
  });

  afterEach(async () => {
    graph.cancelFlush();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // --- slugify ---

  describe('slugify', () => {
    it('lowercases and replaces non-alphanumeric chars', () => {
      expect(graph.slugify('Node-RED')).toBe('node-red');
      expect(graph.slugify('Hello World!')).toBe('hello-world');
    });

    it('strips trailing hyphens', () => {
      expect(graph.slugify('test!!!')).toBe('test');
    });

    it('handles empty string', () => {
      expect(graph.slugify('')).toBe('');
    });
  });

  // --- addNode ---

  describe('addNode', () => {
    it('creates a new node with default type', () => {
      const node = graph.addNode('Node-RED');
      expect(node.id).toBe('node-red');
      expect(node.label).toBe('Node-RED');
      expect(node.type).toBe('concept');
      expect(node.created).toBeTruthy();
    });

    it('returns existing node on duplicate', () => {
      const first = graph.addNode('Node-RED', 'tool');
      const second = graph.addNode('node-red');
      expect(second).toBe(first);
      expect(second.type).toBe('tool');
    });

    it('sets custom type', () => {
      const node = graph.addNode('Bun', 'tool');
      expect(node.type).toBe('tool');
    });
  });

  // --- addEdge ---

  describe('addEdge', () => {
    it('creates a new edge with weight 0.5', () => {
      graph.addNode('A');
      graph.addNode('B');
      const edge = graph.addEdge('a', 'b', 'uses');
      expect(edge.weight).toBe(0.5);
      expect(edge.from).toBe('a');
      expect(edge.to).toBe('b');
      expect(edge.rel).toBe('uses');
    });

    it('reinforces existing edge weight by 0.1', () => {
      graph.addNode('A');
      graph.addNode('B');
      graph.addEdge('a', 'b', 'uses');
      const reinforced = graph.addEdge('a', 'b', 'uses');
      expect(reinforced.weight).toBeCloseTo(0.6);
    });

    it('caps weight at 1.0', () => {
      graph.addNode('A');
      graph.addNode('B');
      for (let i = 0; i < 10; i++) graph.addEdge('a', 'b', 'uses');
      const edge = graph.addEdge('a', 'b', 'uses');
      expect(edge.weight).toBe(1.0);
    });
  });

  // --- neighbors ---

  describe('neighbors', () => {
    beforeEach(() => {
      graph.addNode('Node-RED', 'tool');
      graph.addNode('MQTT', 'tool');
      graph.addNode('Docker', 'tool');
      graph.addNode('JavaScript', 'language');
      graph.addEdge('node-red', 'mqtt', 'uses');
      graph.addEdge('node-red', 'docker', 'depends_on');
      graph.addEdge('node-red', 'javascript', 'uses');
    });

    it('returns depth-1 neighbors', () => {
      const result = graph.neighbors('node-red', 1);
      expect(result).toHaveLength(3);
      expect(result.map(r => r.id)).toContain('mqtt');
      expect(result.map(r => r.id)).toContain('docker');
    });

    it('returns incoming neighbors', () => {
      const result = graph.neighbors('mqtt', 1);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('node-red');
      expect(result[0].direction).toBe('incoming');
    });

    it('filters by type', () => {
      const result = graph.neighbors('node-red', 1, 'tool');
      expect(result).toHaveLength(2);
      expect(result.every(r => r.type === 'tool')).toBe(true);
    });

    it('returns empty for unknown node', () => {
      expect(graph.neighbors('unknown')).toEqual([]);
    });

    it('traverses depth 2', () => {
      graph.addNode('Mosquitto', 'tool');
      graph.addEdge('mqtt', 'mosquitto', 'instance_of');
      const result = graph.neighbors('node-red', 2);
      expect(result.map(r => r.id)).toContain('mosquitto');
    });
  });

  // --- shortestPath ---

  describe('shortestPath', () => {
    it('finds direct path', () => {
      graph.addNode('A');
      graph.addNode('B');
      graph.addEdge('a', 'b', 'uses');
      const path = graph.shortestPath('a', 'b');
      expect(path).toHaveLength(2);
      expect(path[0].node).toBe('a');
      expect(path[1].node).toBe('b');
    });

    it('finds multi-hop path', () => {
      graph.addNode('A');
      graph.addNode('B');
      graph.addNode('C');
      graph.addEdge('a', 'b', 'uses');
      graph.addEdge('b', 'c', 'enables');
      const path = graph.shortestPath('a', 'c');
      expect(path).toHaveLength(3);
      expect(path.map(s => s.node)).toEqual(['a', 'b', 'c']);
    });

    it('returns empty for no path', () => {
      graph.addNode('A');
      graph.addNode('B');
      expect(graph.shortestPath('a', 'b')).toEqual([]);
    });

    it('returns single step for same node', () => {
      graph.addNode('A');
      const path = graph.shortestPath('a', 'a');
      expect(path).toHaveLength(1);
    });

    it('returns empty for unknown nodes', () => {
      expect(graph.shortestPath('x', 'y')).toEqual([]);
    });
  });

  // --- JSONL persistence ---

  describe('persistence', () => {
    it('round-trips nodes and edges through JSONL', async () => {
      graph.addNode('Alpha', 'concept');
      graph.addNode('Beta', 'tool');
      graph.addEdge('alpha', 'beta', 'uses');

      await graph.flush();

      const graph2 = new AssociationGraph(tempDir);
      await graph2.load();

      expect(graph2.getNode('alpha')?.label).toBe('Alpha');
      expect(graph2.getNode('beta')?.type).toBe('tool');
      const neighbors = graph2.neighbors('alpha', 1);
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].id).toBe('beta');
    });

    it('skips malformed lines gracefully', async () => {
      const filePath = join(tempDir, '.slashbot', 'graph.jsonl');
      await fs.writeFile(filePath, [
        JSON.stringify({ t: 'n', id: 'good', label: 'Good', type: 'concept', created: new Date().toISOString() }),
        'THIS IS NOT JSON',
        JSON.stringify({ t: 'n', id: 'also-good', label: 'Also Good', type: 'concept', created: new Date().toISOString() }),
      ].join('\n'));

      await graph.load();
      expect(graph.getNode('good')).toBeTruthy();
      expect(graph.getNode('also-good')).toBeTruthy();
      expect(graph.nodeCount()).toBe(2);
    });

    it('creates file with 0600 permissions', async () => {
      graph.addNode('Test');
      await graph.flush();
      const stat = await fs.stat(join(tempDir, '.slashbot', 'graph.jsonl'));
      // 0600 = 384 in decimal, but check owner read+write
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('starts empty when file does not exist', async () => {
      await graph.load();
      expect(graph.nodeCount()).toBe(0);
    });
  });

  // --- extractAndMerge ---

  describe('extractAndMerge', () => {
    it('does nothing when adapter is null', async () => {
      await graph.extractAndMerge('some text', null);
      expect(graph.nodeCount()).toBe(0);
    });

    it('merges extracted nodes and edges', async () => {
      const mockAdapter: LlmAdapter = {
        complete: async () => ({
          text: JSON.stringify({
            nodes: [
              { label: 'JSONL', type: 'tool' },
              { label: 'SQLite', type: 'tool' },
            ],
            edges: [
              { from: 'JSONL', to: 'SQLite', rel: 'chosen_over' },
            ],
          }),
          steps: 1,
          toolCalls: 0,
          finishReason: 'stop',
        }),
      };

      await graph.extractAndMerge('Decided to use JSONL instead of SQLite', mockAdapter);

      expect(graph.getNode('jsonl')).toBeTruthy();
      expect(graph.getNode('sqlite')).toBeTruthy();
      const neighbors = graph.neighbors('jsonl', 1);
      expect(neighbors.some(n => n.id === 'sqlite')).toBe(true);
    });

    it('handles invalid JSON gracefully', async () => {
      const mockAdapter: LlmAdapter = {
        complete: async () => ({
          text: 'This is not valid JSON at all',
          steps: 1,
          toolCalls: 0,
          finishReason: 'stop',
        }),
      };

      await graph.extractAndMerge('some text', mockAdapter);
      expect(graph.nodeCount()).toBe(0);
    });

    it('handles LLM errors gracefully', async () => {
      const mockAdapter: LlmAdapter = {
        complete: async () => { throw new Error('LLM timeout'); },
      };

      await graph.extractAndMerge('some text', mockAdapter);
      expect(graph.nodeCount()).toBe(0);
    });

    it('extracts JSON from markdown code blocks', async () => {
      const mockAdapter: LlmAdapter = {
        complete: async () => ({
          text: '```json\n{"nodes": [{"label": "Test", "type": "concept"}], "edges": []}\n```',
          steps: 1,
          toolCalls: 0,
          finishReason: 'stop',
        }),
      };

      await graph.extractAndMerge('some text', mockAdapter);
      expect(graph.getNode('test')).toBeTruthy();
    });
  });
});

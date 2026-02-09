import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { CommandRegistry, CommandHandler } from './registry';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe('register', () => {
    it('registers a command handler', () => {
      const handler: CommandHandler = {
        name: 'test',
        description: 'A test command',
        usage: '/test',
        execute: vi.fn(),
      };

      registry.register(handler);

      expect(registry.get('test')).toBe(handler);
    });

    it('registers command with aliases', () => {
      const handler: CommandHandler = {
        name: 'help',
        aliases: ['h', '?'],
        description: 'Show help',
        usage: '/help',
        execute: vi.fn(),
      };

      registry.register(handler);

      expect(registry.get('help')).toBe(handler);
      expect(registry.get('h')).toBe(handler);
      expect(registry.get('?')).toBe(handler);
    });

    it('overwrites existing command with same name', () => {
      const handler1: CommandHandler = {
        name: 'foo',
        description: 'First',
        usage: '/foo',
        execute: vi.fn(),
      };
      const handler2: CommandHandler = {
        name: 'foo',
        description: 'Second',
        usage: '/foo',
        execute: vi.fn(),
      };

      registry.register(handler1);
      registry.register(handler2);

      expect(registry.get('foo')?.description).toBe('Second');
    });
  });

  describe('registerAll', () => {
    it('registers multiple handlers', () => {
      const handlers: CommandHandler[] = [
        { name: 'cmd1', description: 'Command 1', usage: '/cmd1', execute: vi.fn() },
        { name: 'cmd2', description: 'Command 2', usage: '/cmd2', execute: vi.fn() },
        { name: 'cmd3', description: 'Command 3', usage: '/cmd3', execute: vi.fn() },
      ];

      registry.registerAll(handlers);

      expect(registry.get('cmd1')).toBeDefined();
      expect(registry.get('cmd2')).toBeDefined();
      expect(registry.get('cmd3')).toBeDefined();
    });
  });

  describe('get', () => {
    it('returns undefined for unknown command', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('is case-sensitive', () => {
      const handler: CommandHandler = {
        name: 'Test',
        description: 'Test',
        usage: '/Test',
        execute: vi.fn(),
      };

      registry.register(handler);

      expect(registry.get('Test')).toBe(handler);
      expect(registry.get('test')).toBeUndefined();
    });
  });

  describe('execute', () => {
    it('executes registered command', async () => {
      const executeFn = vi.fn().mockResolvedValue(true);
      const handler: CommandHandler = {
        name: 'greet',
        description: 'Greet user',
        usage: '/greet',
        execute: executeFn,
      };

      registry.register(handler);

      const mockContext = {} as any;
      const result = await registry.execute('greet', ['arg1', 'arg2'], mockContext);

      expect(result).toBe(true);
      expect(executeFn).toHaveBeenCalledWith(['arg1', 'arg2'], mockContext);
    });

    it('returns false for unknown command', async () => {
      const mockContext = {} as any;
      const result = await registry.execute('unknown', [], mockContext);
      expect(result).toBe(false);
    });

    it('passes arguments correctly', async () => {
      const executeFn = vi.fn().mockResolvedValue(true);
      const handler: CommandHandler = {
        name: 'echo',
        description: 'Echo args',
        usage: '/echo',
        execute: executeFn,
      };

      registry.register(handler);

      const mockContext = {} as any;
      await registry.execute('echo', ['hello', 'world', '123'], mockContext);

      expect(executeFn).toHaveBeenCalledWith(['hello', 'world', '123'], mockContext);
    });

    it('handles async execute functions', async () => {
      const executeFn = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return true;
      });
      const handler: CommandHandler = {
        name: 'async',
        description: 'Async command',
        usage: '/async',
        execute: executeFn,
      };

      registry.register(handler);

      const mockContext = {} as any;
      const result = await registry.execute('async', [], mockContext);

      expect(result).toBe(true);
    });
  });

  describe('has', () => {
    it('returns true for registered command', () => {
      const handler: CommandHandler = {
        name: 'exists',
        description: 'Exists',
        usage: '/exists',
        execute: vi.fn(),
      };

      registry.register(handler);

      expect(registry.has('exists')).toBe(true);
    });

    it('returns false for unregistered command', () => {
      expect(registry.has('notexists')).toBe(false);
    });

    it('returns true for alias', () => {
      const handler: CommandHandler = {
        name: 'longname',
        aliases: ['ln'],
        description: 'Long name',
        usage: '/longname',
        execute: vi.fn(),
      };

      registry.register(handler);

      expect(registry.has('ln')).toBe(true);
    });
  });

  describe('getAll', () => {
    it('returns all registered commands', () => {
      const handlers: CommandHandler[] = [
        { name: 'a', description: 'A', usage: '/a', execute: vi.fn() },
        { name: 'b', description: 'B', usage: '/b', execute: vi.fn() },
      ];

      registry.registerAll(handlers);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(h => h.name)).toContain('a');
      expect(all.map(h => h.name)).toContain('b');
    });

    it('does not include aliases as separate entries', () => {
      const handler: CommandHandler = {
        name: 'main',
        aliases: ['m', 'alias'],
        description: 'Main',
        usage: '/main',
        execute: vi.fn(),
      };

      registry.register(handler);

      const all = registry.getAll();
      // Should only have 1 entry, not 3
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('main');
    });
  });

  describe('integration', () => {
    it('full workflow: register, check, execute', async () => {
      const executeFn = vi.fn().mockResolvedValue(true);

      registry.register({
        name: 'workflow',
        aliases: ['wf'],
        description: 'Workflow test',
        usage: '/workflow',
        execute: executeFn,
      });

      // Check existence
      expect(registry.has('workflow')).toBe(true);
      expect(registry.has('wf')).toBe(true);

      // Get handler
      const handler = registry.get('workflow');
      expect(handler?.description).toBe('Workflow test');

      // Execute via name
      const mockContext = {} as any;
      await registry.execute('workflow', ['test'], mockContext);
      expect(executeFn).toHaveBeenCalledTimes(1);

      // Execute via alias
      await registry.execute('wf', ['test2'], mockContext);
      expect(executeFn).toHaveBeenCalledTimes(2);
    });
  });
});

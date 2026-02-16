import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  formatAccessibilityTree,
  type AXNode,
  type ElementRef,
} from '../.slashbot/plugins/browser/session.js';
import { createBrowserPlugin } from '../.slashbot/plugins/browser/index.js';
import { createMockSetupContext } from './helpers.js';

/* ================================================================== */
/*  formatAccessibilityTree — pure logic tests                        */
/* ================================================================== */

describe('formatAccessibilityTree', () => {
  test('assigns refs to interactive elements', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: 'Test Page',
      children: [
        { role: 'heading', name: 'Hello World', level: 1 },
        { role: 'button', name: 'Submit' },
        { role: 'link', name: 'Learn more' },
      ],
    };

    const output = formatAccessibilityTree(tree, refs);

    expect(refs.size).toBe(2);
    expect(refs.get('e1')).toEqual({ role: 'button', name: 'Submit', nth: 0 });
    expect(refs.get('e2')).toEqual({ role: 'link', name: 'Learn more', nth: 0 });
    expect(output).toContain('# Hello World');
    expect(output).toContain('[e1] button "Submit"');
    expect(output).toContain('[e2] link "Learn more"');
  });

  test('handles nested structure with indentation', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: 'Page',
      children: [
        {
          role: 'navigation',
          name: 'Main nav',
          children: [
            { role: 'link', name: 'Home' },
            { role: 'link', name: 'About' },
          ],
        },
      ],
    };

    const output = formatAccessibilityTree(tree, refs);

    expect(refs.size).toBe(2);
    // Navigation label indented 1 level, links indented 2 levels
    expect(output).toContain('  navigation: Main nav');
    expect(output).toContain('    [e1] link "Home"');
    expect(output).toContain('    [e2] link "About"');
  });

  test('handles checkboxes with state', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'checkbox', name: 'Accept terms', checked: true },
        { role: 'checkbox', name: 'Newsletter', checked: false },
      ],
    };

    const output = formatAccessibilityTree(tree, refs);

    expect(output).toContain('[e1] checkbox "Accept terms" [checked]');
    expect(output).toContain('[e2] checkbox "Newsletter" [unchecked]');
  });

  test('handles textbox with value', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'textbox', name: 'Email', value: 'user@test.com' },
      ],
    };

    const output = formatAccessibilityTree(tree, refs);
    expect(output).toContain('[e1] textbox "Email" = "user@test.com"');
  });

  test('handles disabled and required attributes', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'button', name: 'Save', disabled: true },
        { role: 'textbox', name: 'Name', required: true },
      ],
    };

    const output = formatAccessibilityTree(tree, refs);
    expect(output).toContain('[e1] button "Save" [disabled]');
    expect(output).toContain('[e2] textbox "Name" [required]');
  });

  test('deduplicates refs with nth index', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'button', name: 'Delete' },
        { role: 'button', name: 'Delete' },
        { role: 'button', name: 'Delete' },
      ],
    };

    formatAccessibilityTree(tree, refs);

    expect(refs.size).toBe(3);
    expect(refs.get('e1')!.nth).toBe(0);
    expect(refs.get('e2')!.nth).toBe(1);
    expect(refs.get('e3')!.nth).toBe(2);
  });

  test('skips generic/none roles without name', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'generic',
      name: '',
      children: [
        { role: 'none', name: '' },
        { role: 'text', name: 'Hello' },
      ],
    };

    const output = formatAccessibilityTree(tree, refs);
    expect(output).toContain('Hello');
    expect(output).not.toContain('generic');
    expect(output).not.toContain('none');
  });

  test('handles heading levels', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'heading', name: 'Title', level: 1 },
        { role: 'heading', name: 'Subtitle', level: 2 },
        { role: 'heading', name: 'Section', level: 3 },
      ],
    };

    const output = formatAccessibilityTree(tree, refs);
    expect(output).toContain('  # Title');
    expect(output).toContain('  ## Subtitle');
    expect(output).toContain('  ### Section');
  });

  test('handles empty tree', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = { role: 'WebArea', name: '' };
    const output = formatAccessibilityTree(tree, refs);
    expect(refs.size).toBe(0);
    expect(output).toBe('');
  });

  test('handles mixed interactive role', () => {
    const refs = new Map<string, ElementRef>();
    const tree: AXNode = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'combobox', name: 'Country' },
        { role: 'slider', name: 'Volume' },
        { role: 'switch', name: 'Dark mode', checked: true },
        { role: 'radio', name: 'Option A' },
        { role: 'searchbox', name: 'Search' },
        { role: 'spinbutton', name: 'Quantity' },
      ],
    };

    formatAccessibilityTree(tree, refs);
    expect(refs.size).toBe(6);

    const roles = [...refs.values()].map((r) => r.role);
    expect(roles).toEqual(['combobox', 'slider', 'switch', 'radio', 'searchbox', 'spinbutton']);
  });
});

/* ================================================================== */
/*  Plugin setup — tool registration tests                            */
/* ================================================================== */

describe('browser plugin setup', () => {
  test('registers browser tool', () => {
    const plugin = createBrowserPlugin();
    const { tools, context } = createMockSetupContext();

    plugin.setup(context);

    expect(tools.has('browser')).toBe(true);
    const tool = tools.get('browser')!;
    expect(tool.pluginId).toBe('slashbot.browser');
    expect(tool.description).toContain('headless Chromium');
    expect(tool.parameters).toBeDefined();
  });

  test('manifest has correct id and fields', () => {
    const plugin = createBrowserPlugin();
    expect(plugin.manifest.id).toBe('slashbot.browser');
    expect(plugin.manifest.name).toBe('Browser Automation');
    expect(plugin.manifest.version).toBe('0.1.0');
  });
});

/* ================================================================== */
/*  Tool dispatch — argument validation tests                         */
/* ================================================================== */

describe('browser tool dispatch', () => {
  let execute: (args: Record<string, unknown>) => Promise<{ ok: boolean; output?: unknown; error?: unknown; forLlm?: unknown }>;

  beforeEach(() => {
    const plugin = createBrowserPlugin();
    const { tools, context } = createMockSetupContext();
    plugin.setup(context);
    execute = tools.get('browser')!.execute as never;
  });

  test('navigate without url returns error', async () => {
    const result = await execute({ action: 'navigate' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('click without target returns error', async () => {
    const result = await execute({ action: 'click' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('type without target returns error', async () => {
    const result = await execute({ action: 'type', text: 'hello' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('type without text returns error', async () => {
    const result = await execute({ action: 'type', target: 'e1' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('press without key returns error', async () => {
    const result = await execute({ action: 'press' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('select without target returns error', async () => {
    const result = await execute({ action: 'select', values: ['a'] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('select without values returns error', async () => {
    const result = await execute({ action: 'select', target: 'e1' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('hover without target returns error', async () => {
    const result = await execute({ action: 'hover' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('evaluate without code returns error', async () => {
    const result = await execute({ action: 'evaluate' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('closeTab without pageId returns error', async () => {
    const result = await execute({ action: 'closeTab' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('wait without target returns error', async () => {
    const result = await execute({ action: 'wait' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'MISSING_PARAM' });
  });

  test('launch attempts to start a browser (may succeed or fail depending on env)', async () => {
    const result = await execute({ action: 'launch' });
    // Either succeeds (system Chrome found) or fails with BROWSER_ERROR
    if (result.ok) {
      expect(result.output).toMatchObject({ status: 'launched' });
      // Clean up: close the browser we just launched
      await execute({ action: 'close' });
    } else {
      expect(result.error).toMatchObject({ code: 'BROWSER_ERROR' });
    }
  });

  test('tabs on unlaunched browser returns empty list', async () => {
    const result = await execute({ action: 'tabs' });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual([]);
  });

  test('actions requiring a page on unlaunched browser return BROWSER_ERROR', async () => {
    const actions = [
      { action: 'snapshot' },
      { action: 'screenshot' },
      { action: 'click', target: 'e1' },
      { action: 'type', target: 'e1', text: 'hi' },
      { action: 'press', key: 'Enter' },
      { action: 'navigate', url: 'https://example.com' },
      { action: 'back' },
      { action: 'forward' },
      { action: 'newTab' },
      { action: 'closeTab', pageId: 'p1' },
      { action: 'wait', target: '.foo' },
      { action: 'evaluate', code: '1+1' },
      { action: 'hover', target: 'e1' },
      { action: 'select', target: 'e1', values: ['a'] },
    ];

    for (const args of actions) {
      const result = await execute(args);
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({ code: 'BROWSER_ERROR' });
    }
  });
});

/* ================================================================== */
/*  BrowserSession unit tests with mocked Playwright                  */
/* ================================================================== */

describe('BrowserSession', () => {
  // We import session directly and mock playwright-core at module level
  // These tests verify session logic without a real browser.

  test('isRunning is false initially', async () => {
    // Dynamic import to avoid module-level playwright import issues
    const { BrowserSession } = await import('../.slashbot/plugins/browser/session.js');
    const session = new BrowserSession();
    expect(session.isRunning).toBe(false);
  });

  test('getRef returns undefined when no snapshot taken', async () => {
    const { BrowserSession } = await import('../.slashbot/plugins/browser/session.js');
    const session = new BrowserSession();
    expect(session.getRef('e1')).toBeUndefined();
  });

  test('close on non-running session returns not running', async () => {
    const { BrowserSession } = await import('../.slashbot/plugins/browser/session.js');
    const session = new BrowserSession();
    const result = await session.close();
    expect(result).toEqual({ status: 'not running' });
  });
});

/* ================================================================== */
/*  Module export tests                                               */
/* ================================================================== */

describe('browser plugin exports', () => {
  test('exports plugin as default', async () => {
    const mod = await import('../.slashbot/plugins/browser/index.js');
    expect(mod.default).toBeDefined();
    expect(mod.default.manifest.id).toBe('slashbot.browser');
  });

  test('exports plugin as named export', async () => {
    const mod = await import('../.slashbot/plugins/browser/index.js');
    expect(mod.plugin).toBeDefined();
    expect(mod.plugin.manifest.id).toBe('slashbot.browser');
  });

  test('exports createPlugin factory', async () => {
    const mod = await import('../.slashbot/plugins/browser/index.js');
    expect(typeof mod.createPlugin).toBe('function');
    const p = mod.createPlugin();
    expect(p.manifest.id).toBe('slashbot.browser');
  });
});

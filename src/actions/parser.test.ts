import { describe, it, expect } from 'vitest';
import { parseActions } from './parser';

describe('parseActions', () => {
  describe('Bash actions', () => {
    it('parses basic bash action', () => {
      const content = '<bash>ls -la</bash>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: 'bash',
        command: 'ls -la',
        timeout: undefined,
        description: undefined,
        runInBackground: undefined,
      });
    });

    it('parses bash with timeout', () => {
      const content = '<bash timeout="5000">npm install</bash>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('bash');
      expect((actions[0] as any).timeout).toBe(5000);
    });

    it('parses bash with description', () => {
      const content = '<bash description="Install deps">npm install</bash>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).description).toBe('Install deps');
    });

    it('parses bash with background flag', () => {
      const content = '<bash background="true">node server.js</bash>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).runInBackground).toBe(true);
    });

    it('parses multiline bash command', () => {
      const content = `<bash>
echo "line 1"
echo "line 2"
</bash>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).command).toContain('echo "line 1"');
      expect((actions[0] as any).command).toContain('echo "line 2"');
    });
  });

  describe('Read actions', () => {
    it('parses basic read action', () => {
      const content = '<read path="/src/index.ts"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: 'read',
        path: '/src/index.ts',
        offset: undefined,
        limit: undefined,
      });
    });

    it('parses read with offset and limit', () => {
      const content = '<read path="/file.ts" offset="10" limit="50"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).offset).toBe(10);
      expect((actions[0] as any).limit).toBe(50);
    });

    it('parses read with single quotes', () => {
      const content = "<read path='/src/file.ts'/>";
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('/src/file.ts');
    });
  });

  describe('Edit actions', () => {
    it('parses basic edit action', () => {
      const content = `<edit path="/src/file.ts">
<search>const foo = 1;</search>
<replace>const foo = 2;</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('edit');
      expect((actions[0] as any).path).toBe('/src/file.ts');
      expect((actions[0] as any).search).toBe('const foo = 1;');
      expect((actions[0] as any).replace).toBe('const foo = 2;');
    });

    it('parses edit with replaceAll', () => {
      const content = `<edit path="/file.ts" replaceAll="true">
<search>foo</search>
<replace>bar</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).replaceAll).toBe(true);
    });

    it('parses edit with replace_all (snake_case)', () => {
      const content = `<edit path="/file.ts" replace_all="true">
<search>foo</search>
<replace>bar</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).replaceAll).toBe(true);
    });

    it('preserves indentation in search/replace', () => {
      const content = `<edit path="/file.ts">
<search>  function test() {
    return 1;
  }</search>
<replace>  function test() {
    return 2;
  }</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).search).toContain('  function test()');
    });

    // Hardened parsing tests
    it('parses edit with unquoted path', () => {
      const content = `<edit path=src/file.ts>
<search>old</search>
<replace>new</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('src/file.ts');
    });

    it('parses edit with file= instead of path=', () => {
      const content = `<edit file="src/file.ts">
<search>old</search>
<replace>new</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('src/file.ts');
    });

    it('parses edit with extra content between tags', () => {
      const content = `<edit path="src/file.ts">

Here's the edit:

<search>old code</search>

<replace>new code</replace>

</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).search).toBe('old code');
      expect((actions[0] as any).replace).toBe('new code');
    });

    it('parses inline edit without newlines', () => {
      const content = `<edit path="file.ts"><search>old</search><replace>new</replace></edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('file.ts');
    });

    it('parses edit with truncated closing tag', () => {
      const content = `<edit path="file.ts">
<search>old</search>
<replace>new</replace>
</edit`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('file.ts');
    });

    it('parses edit without path but with path in content', () => {
      const content = `<edit>src/file.ts
<search>old</search>
<replace>new</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('src/file.ts');
    });

    it('parses edit with extra </search> after </replace>', () => {
      const content = `<edit path="file.ts"><search>old code</search><replace>new code</replace></search></edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('file.ts');
      expect((actions[0] as any).search).toBe('old code');
      expect((actions[0] as any).replace).toBe('new code');
    });

    it('parses edit with extra </search> and truncated </edit', () => {
      const content = `<edit path="file.ts"><search>old</search><replace>new</replace></search></edit`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('file.ts');
    });

    it('parses edit with empty search and replace', () => {
      const content = `<edit path="file.ts"><search></search><replace></replace></edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('file.ts');
      expect((actions[0] as any).search).toBe('');
      expect((actions[0] as any).replace).toBe('');
    });

    it('parses edit with empty search only', () => {
      const content = `<edit path="file.ts"><search></search><replace>new content</replace></edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).search).toBe('');
      expect((actions[0] as any).replace).toBe('new content');
    });

    it('parses edit with empty replace only', () => {
      const content = `<edit path="file.ts"><search>old content</search><replace></replace></edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).search).toBe('old content');
      expect((actions[0] as any).replace).toBe('');
    });

    it('parses edit with </search> used instead of </replace>', () => {
      const content = `<edit path="file.ts"><search>old</search><replace>new</search></replace>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).search).toBe('old');
      expect((actions[0] as any).replace).toBe('new');
    });

    it('parses edit with </search></edit ending instead of </replace></edit>', () => {
      const content = `<edit path="file.ts"><search>old code</search><replace>new code</search></edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).search).toBe('old code');
      expect((actions[0] as any).replace).toBe('new code');
    });
  });

  describe('Multi-edit actions', () => {
    it('parses multi-edit with multiple edits', () => {
      const content = `<multi-edit path="/src/file.ts">
<edit><search>foo</search><replace>bar</replace></edit>
<edit><search>baz</search><replace>qux</replace></edit>
</multi-edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('multi-edit');
      expect((actions[0] as any).edits).toHaveLength(2);
      expect((actions[0] as any).edits[0].search).toBe('foo');
      expect((actions[0] as any).edits[1].search).toBe('baz');
    });
  });

  describe('Write actions', () => {
    it('parses write action', () => {
      const content = `<write path="/src/new.ts">
export const foo = 'bar';
</write>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('write');
      expect((actions[0] as any).path).toBe('/src/new.ts');
      expect((actions[0] as any).content).toContain("export const foo = 'bar'");
    });

    it('preserves code blocks inside write', () => {
      const content = `<write path="/README.md">
# Title

\`\`\`typescript
const x = 1;
\`\`\`
</write>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).content).toContain('```typescript');
    });
  });

  describe('Glob actions', () => {
    it('parses glob action', () => {
      const content = '<glob pattern="**/*.ts"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: 'glob',
        pattern: '**/*.ts',
        path: undefined,
      });
    });

    it('parses glob with path', () => {
      const content = '<glob pattern="*.ts" path="src"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('src');
    });
  });

  describe('Grep actions', () => {
    it('parses basic grep action', () => {
      const content = '<grep pattern="TODO"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('grep');
      expect((actions[0] as any).pattern).toBe('TODO');
    });

    it('parses grep with all options', () => {
      const content =
        '<grep pattern="error" path="src" output="content" C="3" i="true" lines="true" limit="10"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      const grep = actions[0] as any;
      expect(grep.pattern).toBe('error');
      expect(grep.path).toBe('src');
      expect(grep.outputMode).toBe('content');
      expect(grep.context).toBe(3);
      expect(grep.caseInsensitive).toBe(true);
      expect(grep.lineNumbers).toBe(true);
      expect(grep.headLimit).toBe(10);
    });

    it('parses grep with multiline flag', () => {
      const content = '<grep pattern="struct.*field" multiline="true"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).multiline).toBe(true);
    });
  });

  describe('Fetch actions', () => {
    it('parses fetch action', () => {
      const content = '<fetch url="https://example.com"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: 'fetch',
        url: 'https://example.com',
        prompt: undefined,
      });
    });

    it('parses fetch with prompt', () => {
      const content = '<fetch url="https://docs.example.com" prompt="Extract the API docs"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).prompt).toBe('Extract the API docs');
    });
  });

  describe('Search actions', () => {
    it('parses search action', () => {
      const content = '<search query="typescript tutorial"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('search');
      expect((actions[0] as any).query).toBe('typescript tutorial');
    });

    it('parses search with domain filters', () => {
      const content =
        '<search query="react docs" domains="reactjs.org,github.com" exclude="medium.com"/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).allowedDomains).toEqual(['reactjs.org', 'github.com']);
      expect((actions[0] as any).blockedDomains).toEqual(['medium.com']);
    });
  });

  describe('Schedule actions', () => {
    it('parses schedule with command', () => {
      const content = '<schedule cron="0 9 * * *" name="Daily backup">./backup.sh</schedule>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('schedule');
      expect((actions[0] as any).cron).toBe('0 9 * * *');
      expect((actions[0] as any).name).toBe('Daily backup');
      expect((actions[0] as any).command).toBe('./backup.sh');
    });

    it('parses schedule with prompt type', () => {
      const content =
        '<schedule cron="*/30 * * * *" name="Status check" type="prompt">Check system status and notify if issues</schedule>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).prompt).toBe('Check system status and notify if issues');
      expect((actions[0] as any).command).toBeUndefined();
    });
  });

  describe('Notify actions', () => {
    it('parses notify action', () => {
      const content = '<notify>Task completed successfully!</notify>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('notify');
      expect((actions[0] as any).message).toBe('Task completed successfully!');
    });

    it('parses notify with target', () => {
      const content = '<notify to="telegram">Deployment finished</notify>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).target).toBe('telegram');
    });
  });

  // NOTE: Plan actions were removed from the system

  describe('Code block prevention', () => {
    it('ignores actions inside fenced code blocks', () => {
      const content = `Here is an example:
\`\`\`
<bash>rm -rf /</bash>
\`\`\`
Real action: <bash>ls</bash>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).command).toBe('ls');
    });

    it('ignores actions inside inline code', () => {
      const content = 'Use `<bash>command</bash>` to run. <bash>echo hello</bash>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).command).toBe('echo hello');
    });

    it('ignores actions inside <literal> blocks', () => {
      const content = `<literal><bash>dangerous</bash></literal> <bash>safe</bash>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).command).toBe('safe');
    });
  });

  describe('Truncated tag fixing', () => {
    it('fixes truncated closing tags', () => {
      const content = `<edit path="/file.ts">
<search>old</search>
<replace>new</replace>
</edit`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('edit');
    });

    it('fixes malformed inner tags', () => {
      const content = `<edit path="/file.ts">
<search">old</search>
<replace">new</replace>
</edit>`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
    });
  });

  describe('Multiple actions', () => {
    it('parses multiple different action types', () => {
      const content = `
<read path="/file.ts"/>
<bash>npm test</bash>
<glob pattern="*.md"/>
`;
      const actions = parseActions(content);
      expect(actions).toHaveLength(3);
      // Order depends on parsing order in parseActions (bash before read)
      expect(actions.map(a => a.type).sort()).toEqual(['bash', 'glob', 'read']);
    });
  });

  describe('Edge cases', () => {
    it('handles empty content', () => {
      const actions = parseActions('');
      expect(actions).toHaveLength(0);
    });

    it('handles content with no actions', () => {
      const actions = parseActions('Just some regular text without any actions.');
      expect(actions).toHaveLength(0);
    });

    it('handles unquoted attribute values', () => {
      const content = '<read path=/src/file.ts/>';
      const actions = parseActions(content);
      expect(actions).toHaveLength(1);
      expect((actions[0] as any).path).toBe('/src/file.ts'); // Strips trailing /> from tag closing
    });
  });
});

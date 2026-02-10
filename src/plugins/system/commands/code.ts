/**
 * Code Commands - paste-image, init
 */

import * as path from 'path';
import { display } from '../../../core/ui';
import type { CommandHandler } from '../../../core/commands/registry';

export const pasteImageCommand: CommandHandler = {
  name: 'paste-image',
  description: 'Paste image from system clipboard',
  usage: '/paste-image',
  aliases: ['pi'],
  group: 'Code',
  execute: async () => {
    const { readImageFromClipboard } = await import('../../tui/pasteHandler');
    const { addImage } = await import('../../filesystem/services/ImageBuffer');

    const dataUrl = await readImageFromClipboard();

    if (dataUrl) {
      addImage(dataUrl);
      const sizeKB = Math.round(dataUrl.length / 1024);
      display.image('clipboard', sizeKB);
      display.imageResult();
    } else {
      display.warning('No image in clipboard (install xclip/wl-clipboard on Linux)');
    }
    return true;
  },
};

export const initCommand: CommandHandler = {
  name: 'init',
  description: 'Create project context file (GROK.md) using AI analysis',
  usage: '/init',
  group: 'Code',
  execute: async (args, context) => {
    const workDir = context.codeEditor?.getWorkDir() || process.cwd();

    const contextFileNames = ['CLAUDE.md', 'GROK.md', 'SLASHBOT.md'];
    for (const fileName of contextFileNames) {
      const existingPath = path.join(workDir, fileName);
      const existingFile = Bun.file(existingPath);
      if (await existingFile.exists()) {
        display.warningText(fileName + ' already exists');
        display.muted('File: ' + existingPath);
        display.muted('Delete it to create a new one');
        return true;
      }
    }

    if (!context.grokClient) {
      display.errorText(
        'Grok API not configured. Set GROK_API_KEY or XAI_API_KEY environment variable.',
      );
      return true;
    }

    const contextFile = path.join(workDir, 'GROK.md');

    display.muted('Gathering codebase context...');
    const { gatherCodebaseContext } = await import('../../explore/codebaseContext');
    const codebaseContext = await gatherCodebaseContext();

    const generatePrompt = `You are analyzing a codebase to generate comprehensive documentation.

## STEP 1: ANALYZE THE CODE FIRST

Before writing anything, carefully study the provided codebase analysis:
- Read through ALL the source files provided
- Understand the imports and dependencies between files
- Identify the main patterns and conventions used
- Note the entry points and how the application flows
- Understand what each directory contains and why
- Identify the key abstractions and how they relate
- Look for configuration files and understand the settings
- Study the package.json for scripts and dependencies

Take your time to understand the codebase deeply before documenting it.

## STEP 2: GENERATE GROK.md

Now generate a COMPREHENSIVE, PROLIFIC GROK.md file.

This file will be used by AI assistants (like Slashbot, Claude, GPT) to understand and work with this codebase. It must be DETAILED and ACTIONABLE.

## REQUIRED SECTIONS (be thorough and verbose):

### 1. PROJECT OVERVIEW
- Project name, purpose, and what problem it solves
- Target users/audience
- Current status (alpha, beta, production, etc.)
- License if specified

### 2. TECH STACK & LANGUAGES
- Primary language(s) with version requirements
- Runtime (Node, Bun, Deno, Python version, etc.)
- Framework(s) used (React, Vue, Express, FastAPI, etc.)
- Major libraries and their purposes
- Package manager used

### 3. ARCHITECTURE & DESIGN PATTERNS
- High-level architecture (monolith, microservices, modular, etc.)
- Design patterns used (MVC, MVVM, Clean Architecture, etc.)
- State management approach
- Data flow patterns
- Error handling patterns

### 4. DIRECTORY STRUCTURE
- Explain EVERY major directory and its purpose
- Key files and what they do
- Entry points and how the app bootstraps
- Where to find specific types of code (routes, models, utils, etc.)

### 5. CODE CONVENTIONS & STYLE
- Formatting rules (tabs/spaces, line length, quotes)
- Naming conventions (camelCase, snake_case, etc.)
- Import ordering
- Comment style and documentation requirements
- Type annotation expectations
- Error handling conventions

### 6. HOW TO USE (for developers)
- Installation steps (exact commands)
- Environment setup (.env variables with descriptions)
- Running in development mode
- Running tests
- Building for production
- Deployment process if documented

### 7. HOW TO DEVELOP & EXTEND
- Adding new features: where to put new code
- Adding new API endpoints: step-by-step
- Adding new components/modules: conventions
- Database changes: migration workflow
- Testing: how to write and run tests

### 8. COMMON TASKS & PATTERNS
- List common operations with code examples
- How to handle authentication (if applicable)
- How to interact with the database (if applicable)
- How to add/modify UI components (if applicable)
- How to add new CLI commands (if applicable)

### 9. DEPENDENCIES & EXTERNAL SERVICES
- Database requirements
- API keys needed
- External services integration
- Docker/container requirements

### 10. GOTCHAS & IMPORTANT NOTES
- Non-obvious behaviors
- Performance considerations
- Security considerations
- Breaking changes history
- Known issues or limitations

### 11. COMMAND REFERENCE
- All npm/bun/yarn scripts with descriptions
- CLI commands if applicable
- Common development commands

Be PROLIFIC. Write DETAILED explanations. Include CODE EXAMPLES where helpful.
This document should allow any AI or developer to immediately understand and work on the project.

DO NOT include any XML tags or action syntax.
Output ONLY clean markdown.

${codebaseContext}`;

    display.muted('Asking Grok to analyze and generate GROK.md...');

    display.startThinking('Generating GROK.md...');

    try {
      const apiKey =
        context.configManager?.getApiKey() || process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      if (!apiKey) {
        display.stopThinking();
        display.errorText(
          'Grok API key not configured. Use /login or set GROK_API_KEY environment variable.',
        );
        return true;
      }
      const baseUrl = 'https://api.x.ai/v1';

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-reasoning',
          messages: [
            {
              role: 'system',
              content: `You are an expert code analyst and technical writer. Your task is to:
1. FIRST: Deeply analyze the provided codebase - understand the architecture, patterns, file relationships, and conventions
2. THEN: Generate comprehensive documentation that allows developers and AI assistants to immediately understand and work with the project

Be thorough in your analysis. Read every file provided. Understand how they connect. Only then write the documentation.
Include real code examples from the actual codebase. Explain the "why" behind patterns.
Write in clear markdown with proper formatting.`,
            },
            { role: 'user', content: generatePrompt },
          ],
          max_tokens: 16384,
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        display.stopThinking();
        const errorText = await response.text();
        display.errorText('Grok API Error: ' + response.status + ' - ' + errorText);
        return true;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let generatedContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              generatedContent += content;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      const duration = display.stopThinking();

      if (!generatedContent.trim()) {
        display.errorText('Grok returned empty response');
        return true;
      }

      await Bun.write(contextFile, generatedContent.trim());
      display.muted(duration);
      display.successText('File created: GROK.md');
      display.muted('Generated by Grok AI based on codebase analysis');
      display.muted('Compatible with CLAUDE.md and SLASHBOT.md');
    } catch (error) {
      display.stopThinking();
      display.errorText('Error: ' + error);
    }

    return true;
  },
};

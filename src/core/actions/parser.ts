import type { Action } from './types';
import { registerActionTags } from '../utils/tagRegistry';

export type ParserUtils = {
  extractAttr: (tag: string, attr: string) => string | undefined;
  extractBoolAttr: (tag: string, attr: string) => boolean;
};

export type ActionParserConfig = {
  tags: string[];
  selfClosingTags?: string[];
  parse: (content: string, utils: ParserUtils) => Action[];
  protectedTags?: string[];
  fixups?: Array<{ from: RegExp; to: string }> | ((content: string) => string);
  preStrip?: RegExp | boolean;
  stripAfterParse?: string[];
};

let actionParsers: ActionParserConfig[] = [];

export function registerActionParser(config: ActionParserConfig): void {
  actionParsers.push(config);
  registerActionTags(config.tags);
  if (config.selfClosingTags) {
    registerActionTags(config.selfClosingTags);
  }
}

export function clearActionParsers(): void {
  actionParsers = [];
}

export function parseActions(content: string): Action[] {
  const actions: Action[] = [];
  const utils: ParserUtils = { extractAttr, extractBoolAttr };

  // Apply fixups before parsing — correct common LLM formatting mistakes
  let fixedContent = content;
  for (const parser of actionParsers) {
    if (parser.fixups) {
      if (typeof parser.fixups === 'function') {
        fixedContent = parser.fixups(fixedContent);
      } else {
        for (const fixup of parser.fixups) {
          fixedContent = fixedContent.replace(fixup.from, fixup.to);
        }
      }
    }
  }

  // Two-phase parsing to prevent inner tags in code content from being
  // executed as actions (e.g. <bash>cmd</bash> inside an <edit> or <write> block).
  // Phase 1: Parse content-bearing tags (preStrip) that contain arbitrary code/text.
  const contentTags: string[] = [];
  for (const parser of actionParsers) {
    if (parser.preStrip) {
      actions.push(...parser.parse(fixedContent, utils));
      contentTags.push(...parser.tags);
    }
  }

  // Strip content-bearing tag blocks so their inner content is not seen by other parsers.
  let strippedContent = fixedContent;
  for (const tag of contentTags) {
    strippedContent = strippedContent.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'),
      '',
    );
  }

  // Phase 2: Parse remaining tags on the stripped content.
  for (const parser of actionParsers) {
    if (!parser.preStrip) {
      actions.push(...parser.parse(strippedContent, utils));
    }
  }

  return actions;
}

export function extractAttr(tag: string, attr: string): string | undefined {
  const regex = new RegExp(`${attr}="([^"]*)"`); // Simple regex for attr="value"
  const match = tag.match(regex);
  return match ? match[1] : undefined;
}

export function extractBoolAttr(tag: string, attr: string): boolean {
  const value = extractAttr(tag, attr);
  return value === 'true';
}

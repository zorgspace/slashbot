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
  for (const parser of actionParsers) {
    actions.push(...parser.parse(content, utils));
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

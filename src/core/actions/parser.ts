import type { Action } from './types';
import { registerActionTags, unregisterActionTags } from '../utils/tagRegistry';

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

function buildTagVariants(tag: string): string[] {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  if (normalized.includes('-')) {
    variants.add(normalized.replace(/-/g, '_'));
  }
  if (normalized.includes('_')) {
    variants.add(normalized.replace(/_/g, '-'));
  }
  return Array.from(variants);
}

function buildCanonicalTagMap(): Map<string, string> {
  const canonicalMap = new Map<string, string>();

  for (const parser of actionParsers) {
    const canonical = parser.tags[0]?.trim().toLowerCase();
    if (!canonical) continue;
    const sourceTags = [...parser.tags, ...(parser.selfClosingTags || [])];
    for (const tag of sourceTags) {
      for (const variant of buildTagVariants(tag)) {
        if (!canonicalMap.has(variant)) {
          canonicalMap.set(variant, canonical);
        }
      }
    }
  }

  return canonicalMap;
}

function normalizeActionTagVariants(content: string): string {
  const canonicalMap = buildCanonicalTagMap();
  if (canonicalMap.size === 0) {
    return content;
  }

  // Normalize aliases like <read_file> / <read-file> to the parser's canonical tag
  // so predefined actions are always parsed and executed.
  return content.replace(/<(\/?)([a-z][a-z0-9_-]*)(?=[\s/>])/gi, (full, slash, tagName) => {
    const canonical = canonicalMap.get(String(tagName).toLowerCase());
    if (!canonical) {
      return full;
    }
    return `<${slash}${canonical}`;
  });
}

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

/**
 * Remove all parsers whose tags overlap with the given set.
 * Also unregisters those tags from the tag registry.
 */
export function unregisterActionParsersForTags(tags: string[]): void {
  const tagSet = new Set(tags);
  const removed: string[] = [];
  actionParsers = actionParsers.filter(p => {
    const overlaps = p.tags.some(t => tagSet.has(t));
    if (overlaps) {
      removed.push(...p.tags);
      if (p.selfClosingTags) removed.push(...p.selfClosingTags);
    }
    return !overlaps;
  });
  unregisterActionTags(removed);
}

export function parseActions(content: string): Action[] {
  const actions: Action[] = [];
  const utils: ParserUtils = { extractAttr, extractBoolAttr };

  // Normalize tag aliases before parser-specific fixups/parsing.
  // This catches predefined action variants and prevents them from leaking as plain content.
  const normalizedContent = normalizeActionTagVariants(content);

  // Apply fixups before parsing — correct common LLM formatting mistakes
  let fixedContent = normalizedContent;
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
  const normalizedAttr = attr.trim();
  if (!normalizedAttr) return undefined;
  const escapedAttr = normalizedAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `\\b${escapedAttr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`,
    'i',
  );
  const match = tag.match(regex);
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

export function extractBoolAttr(tag: string, attr: string): boolean {
  const value = extractAttr(tag, attr)?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

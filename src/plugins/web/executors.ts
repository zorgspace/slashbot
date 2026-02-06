/**
 * Web Action Handlers - Fetch and Search operations
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { FetchAction, SearchAction } from './types';
import { display } from '../../core/ui';

export async function executeFetch(
  action: FetchAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onFetch) return null;

  const shortUrl = action.url.length > 50 ? action.url.slice(0, 47) + '...' : action.url;
  const promptInfo = action.prompt ? `, "${action.prompt.slice(0, 30)}..."` : '';
  display.tool('Fetch', `${shortUrl}${promptInfo}`);

  try {
    const content = await handlers.onFetch(action.url, action.prompt);
    const lines = content.split('\n').length;
    const charCount = content.length;

    display.result(`Fetched ${charCount} chars, ${lines} lines`);

    return {
      action: `Fetch: ${action.url}`,
      success: true,
      result: content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.error(`Fetch failed: ${errorMsg}`);
    return {
      action: `Fetch: ${action.url}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

export async function executeSearch(
  action: SearchAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!handlers.onSearch) return null;

  const domainInfo = action.allowedDomains?.length
    ? ` (domains: ${action.allowedDomains.join(', ')})`
    : action.blockedDomains?.length
      ? ` (exclude: ${action.blockedDomains.join(', ')})`
      : '';
  display.tool('Search', `"${action.query}"${domainInfo}`);

  try {
    const { response, citations } = await handlers.onSearch(action.query, {
      allowedDomains: action.allowedDomains,
      blockedDomains: action.blockedDomains,
    });

    if (citations.length > 0) {
      const citationPreview = citations.join(', ');
      display.result(
        `Found ${citations.length} sources: ${citationPreview}`,
      );
    } else {
      display.result('Search completed');
    }

    return {
      action: `Search: ${action.query}`,
      success: true,
      result: response,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.error(`Search failed: ${errorMsg}`);
    return {
      action: `Search: ${action.query}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}

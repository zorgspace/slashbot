/**
 * Web Search Service - Search the web using DuckDuckGo
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  results: SearchResult[];
  answer?: string; // Instant answer if available
}

/**
 * Search the web using DuckDuckGo HTML
 */
export async function searchWeb(query: string, maxResults = 5): Promise<WebSearchResult> {
  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Slashbot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const html = await response.text();
    const results = parseSearchResults(html, maxResults);

    return {
      query,
      results,
    };
  } catch (error) {
    return {
      query,
      results: [],
    };
  }
}

/**
 * Parse search results from DuckDuckGo HTML
 */
function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const url = decodeURIComponent(match[1].replace(/.*uddg=/, '').replace(/&.*/, ''));
    const title = match[2].trim();
    const snippet = match[3].replace(/<[^>]*>/g, '').trim();

    if (url && title) {
      results.push({ title, url, snippet });
    }
  }

  // Fallback: simpler parsing if regex didn't work
  if (results.length === 0) {
    const linkRegex = /<a[^>]*class="result__url"[^>]*href="([^"]*)"[^>]*>/gi;
    const titleRegex = /<a[^>]*class="result__a"[^>]*>([^<]*)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*)/gi;

    const urls: string[] = [];
    const titles: string[] = [];
    const snippets: string[] = [];

    while ((match = linkRegex.exec(html)) !== null) urls.push(match[1]);
    while ((match = titleRegex.exec(html)) !== null) titles.push(match[1]);
    while ((match = snippetRegex.exec(html)) !== null) snippets.push(match[1]);

    for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
      results.push({
        title: titles[i] || 'No title',
        url: urls[i] || '',
        snippet: snippets[i] || '',
      });
    }
  }

  return results;
}

/**
 * Fetch and extract text content from a URL
 */
export async function fetchPage(url: string, maxLength = 5000): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Slashbot/1.0)',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return `Error: ${response.status}`;
    }

    const html = await response.text();

    // Extract text content, removing scripts, styles, and HTML tags
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();

    // Truncate if too long
    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + '...';
    }

    return text;
  } catch (error) {
    return `Error fetching page: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Format search results for display
 */
export function formatResults(result: WebSearchResult): string {
  if (result.results.length === 0) {
    return 'No results found.';
  }

  const lines = result.results.map((r, i) =>
    `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
  );

  return lines.join('\n\n');
}

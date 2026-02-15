import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ProviderModel, StructuredLogger } from '../kernel/contracts.js';

interface GatewayModelEntry {
  id: string;
  name: string;
  type: string;
  context_window?: number;
  tags?: string[];
}

interface GatewayModelsResponse {
  data: GatewayModelEntry[];
}

interface CatalogCache {
  fetchedAt: number;
  models: ProviderModel[];
}

const GATEWAY_CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

const TAG_TO_CAPABILITY: Record<string, string> = {
  'tool-use': 'tools',
  'vision': 'image',
  'reasoning': 'reasoning',
  'file-input': 'image',
};

function mapCapabilities(tags: string[]): string[] {
  const caps = new Set<string>(['chat']);
  for (const tag of tags) {
    const mapped = TAG_TO_CAPABILITY[tag];
    if (mapped) {
      caps.add(mapped);
    } else {
      caps.add(tag);
    }
  }
  return [...caps];
}

function cachePath(): string {
  return join(process.env.HOME ?? process.env.USERPROFILE ?? '/tmp', '.slashbot', 'gateway-catalog-cache.json');
}

async function readCache(logger: StructuredLogger): Promise<ProviderModel[] | null> {
  try {
    const raw = await fs.readFile(cachePath(), 'utf8');
    const cache = JSON.parse(raw) as CatalogCache;
    if (Date.now() - cache.fetchedAt < CACHE_TTL_MS && cache.models.length > 0) {
      logger.debug('Using cached gateway catalog', { count: cache.models.length });
      return cache.models;
    }
  } catch { /* no cache or invalid */ }
  return null;
}

async function writeCache(models: ProviderModel[]): Promise<void> {
  const dir = join(process.env.HOME ?? process.env.USERPROFILE ?? '/tmp', '.slashbot');
  await fs.mkdir(dir, { recursive: true });
  const cache: CatalogCache = { fetchedAt: Date.now(), models };
  await fs.writeFile(cachePath(), JSON.stringify(cache), 'utf8');
}

export async function fetchGatewayCatalog(logger: StructuredLogger): Promise<ProviderModel[]> {
  // Return cached catalog if fresh enough
  const cached = await readCache(logger);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(GATEWAY_CATALOG_URL, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn('Gateway catalog fetch failed', { status: response.status });
      return [];
    }

    const body = (await response.json()) as GatewayModelsResponse;
    const models: ProviderModel[] = [];

    for (const entry of body.data) {
      if (entry.type !== 'language') continue;

      models.push({
        id: entry.id,
        displayName: entry.name,
        contextWindow: entry.context_window ?? 128_000,
        priority: 100,
        capabilities: mapCapabilities(entry.tags ?? []),
      });
    }

    logger.debug('Fetched gateway model catalog', { count: models.length });
    await writeCache(models).catch(() => {});
    return models;
  } catch (error) {
    logger.warn('Failed to fetch gateway catalog', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

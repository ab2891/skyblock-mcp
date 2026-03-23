/**
 * Hypixel API client with caching and rate limiting.
 * Rate limit: 120 requests/min (2/sec).
 */

const BASE = "https://api.hypixel.net/v2";

let apiKey = process.env.HYPIXEL_API_KEY ?? "";

export function setApiKey(key: string) {
  apiKey = key;
}

// --- Simple in-memory cache ---

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60_000; // 1 minute

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// --- Rate limiter (token bucket) ---

let tokens = 10;
const MAX_TOKENS = 10;
const REFILL_INTERVAL_MS = 500; // 2 tokens/sec = 120/min

setInterval(() => {
  tokens = Math.min(MAX_TOKENS, tokens + 1);
}, REFILL_INTERVAL_MS);

async function waitForToken(): Promise<void> {
  while (tokens <= 0) {
    await new Promise((r) => setTimeout(r, REFILL_INTERVAL_MS));
  }
  tokens--;
}

// --- API helpers ---

async function apiGet(path: string, params: Record<string, string> = {}, ttlMs = DEFAULT_TTL_MS): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const cacheKey = url.toString();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await waitForToken();

  const res = await fetch(url.toString(), {
    headers: { "API-Key": apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hypixel API ${res.status}: ${body}`);
  }

  const json = await res.json();
  setCache(cacheKey, json, ttlMs);
  return json;
}

// --- Public API methods ---

export async function getPlayerByName(name: string): Promise<{ uuid: string }> {
  const data = (await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`).then((r) =>
    r.json()
  )) as { id: string; name: string };
  return { uuid: data.id };
}

export async function getPlayer(uuid: string): Promise<unknown> {
  return apiGet("/player", { uuid });
}

export async function getSkyblockProfiles(uuid: string): Promise<unknown> {
  return apiGet("/skyblock/profiles", { uuid });
}

export async function getBazaar(): Promise<unknown> {
  return apiGet("/skyblock/bazaar", {}, 30_000); // 30s cache — prices move fast
}

export async function getAuctions(page = 0): Promise<unknown> {
  return apiGet("/skyblock/auctions", { page: String(page) }, 30_000);
}

export async function getAuctionsByPlayer(uuid: string): Promise<unknown> {
  return apiGet("/skyblock/auction", { player: uuid }, 30_000);
}

export async function getElection(): Promise<unknown> {
  return apiGet("/resources/skyblock/election", {}, 300_000); // 5 min cache
}

export async function getItems(): Promise<unknown> {
  return apiGet("/resources/skyblock/items", {}, 600_000); // 10 min cache
}

export async function getCollections(): Promise<unknown> {
  return apiGet("/resources/skyblock/collections", {}, 600_000);
}

export async function getSkills(): Promise<unknown> {
  return apiGet("/resources/skyblock/skills", {}, 600_000);
}

import type { Settings } from '../types';
import { HttpApiClient } from './http';
import { MockApiClient } from './mock';
import { ApiError, type ApiClient } from './types';

export * from './types';
export { MockApiClient, HttpApiClient };

const mock = new MockApiClient();

/** Rebuilt only when the settings that define it change; the client is stateless. */
let cached: { baseUrl: string; apiKey: string; client: HttpApiClient } | null = null;

function httpClient(settings: Settings): HttpApiClient {
  const baseUrl = settings.baseUrl.trim();
  const apiKey = settings.apiKey.trim();
  if (!cached || cached.baseUrl !== baseUrl || cached.apiKey !== apiKey) {
    cached = { baseUrl, apiKey, client: new HttpApiClient(baseUrl, apiKey) };
  }
  return cached.client;
}

/**
 * Picks the client for the current settings.
 *
 * The real backend takes over only once a URL and key are present *and* "Test
 * connection" has passed — `connectionOk` is what proves the key was accepted,
 * since a reachable URL says nothing about whether the server will have us.
 * Anything short of that stays on the mock, so the app is never left without a
 * working sync path.
 */
export function getApiClient(settings: Settings): ApiClient {
  const usable = settings.baseUrl.trim() && settings.apiKey.trim() && settings.connectionOk;
  return usable ? httpClient(settings) : mock;
}

/**
 * What the Settings screen runs behind "Test connection".
 *
 * Two steps, because they fail for different reasons: /health is public, so it
 * only proves the VM is reachable over Tailscale, and an empty /sync is the
 * cheapest request that actually exercises the API key. Testing the key matters
 * — it is the half the user is most likely to paste wrong.
 */
export async function testConnection(
  settings: Settings
): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = new HttpApiClient(settings.baseUrl, settings.apiKey);
  try {
    if (!(await client.health())) {
      return { ok: false, message: 'serverul raspunde dar baza de date e picata' };
    }
    await client.sync({ notes: [], new_categories: [], deleted_categories: [] });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : String(error) };
  }
}

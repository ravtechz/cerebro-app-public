import { ApiError, type ApiClient, type SyncPayload, type SyncResponse } from './types';

/**
 * Budget for a request that carries no categorization work — plain mutations
 * (done, trash, restore) are a database round trip and nothing more.
 */
export const BASE_TIMEOUT_MS = 20_000;

/**
 * Extra budget per note the server has to send through the LLM.
 *
 * The backend categorizes sequentially, one call per note, and gemma3:4b on the
 * VM measured a 2.5s median with an 8.8s worst case. A fixed 20s ceiling would
 * expire while the server was still working — and because /sync commits in one
 * transaction, that batch would land anyway. The phone would never see the
 * success, retry forever, and eventually mark healthy notes as errors. Waiting
 * is cheap; a false timeout is not.
 */
export const CATEGORIZE_BUDGET_MS = 12_000;

export function timeoutFor(payload: SyncPayload): number {
  const categorizing = payload.notes.filter((n) => n.needs_categorization).length;
  return BASE_TIMEOUT_MS + categorizing * CATEGORIZE_BUDGET_MS;
}

/**
 * The real backend, over Tailscale.
 *
 * Same contract as MockApiClient — the worker and the UI never learn which one
 * they are holding. Anything the caller should retry leaves here as ApiError.
 */
export class HttpApiClient implements ApiClient {
  readonly kind = 'http' as const;

  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly apiKey: string) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
  }

  /** Unauthenticated on purpose: /health is public, so it only proves reachability. */
  async health(): Promise<boolean> {
    const body = await this.request<{ status: string; db: boolean }>('/health', {
      method: 'GET',
      timeoutMs: BASE_TIMEOUT_MS,
    });
    return body.status === 'ok' && body.db === true;
  }

  async sync(payload: SyncPayload): Promise<SyncResponse> {
    return this.request<SyncResponse>('/sync', {
      method: 'POST',
      timeoutMs: timeoutFor(payload),
      apiKey: this.apiKey,
      body: payload,
    });
  }

  private async request<T>(
    path: string,
    options: { method: 'GET' | 'POST'; timeoutMs: number; apiKey?: string; body?: unknown }
  ): Promise<T> {
    if (!this.baseUrl) throw new ApiError('base url lipseste');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.apiKey ? { 'X-Api-Key': options.apiKey } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      // fetch rejects for DNS, refused connections, Tailscale being off, iOS
      // denying the app network access — and for our own abort, which deserves
      // its own message. Keep the platform's text: collapsing every cause into
      // one string turns a five-second diagnosis into an evening of guessing.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(`timeout dupa ${Math.round(options.timeoutMs / 1000)}s`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApiError(detail ? `retea indisponibila: ${detail}` : 'retea indisponibila');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ApiError(await describeFailure(response), response.status);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('raspuns invalid de la server', response.status);
    }
  }
}

/** Turns the backend's `{"detail": ...}` into something worth showing in Settings. */
async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401) return 'cheie API respinsa (401)';
  let detail = '';
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') detail = body.detail;
  } catch {
    // Not JSON — the status alone has to carry the message.
  }
  return detail ? `${response.status}: ${detail}` : `eroare server (${response.status})`;
}

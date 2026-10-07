import { listCategories } from '../db/categories';
import { INBOX_ID } from '../types';
import { ApiError, type ApiClient, type SyncCategoryOut, type SyncPayload, type SyncResponse } from './types';

const LATENCY_MS = 800;
const CONFIDENCE_THRESHOLD = 0.7;

/** Every Nth note pushed makes the cycle fail, so backoff is visible in the demo. */
const FAIL_EVERY = 4;

/** Keyword heuristic standing in for the LLM until Faza 05. */
const RULES: ReadonlyArray<[RegExp, string]> = [
  [/film|serial|imdb|de vazut|netflix|cinema|regiz|blade|dune/i, 'Filme'],
  [/todo|de facut|plate|reinnoi|suna |cumpar|deadline|maine|expir|factur|programare/i, 'Todos'],
  [/youtube|video|episod|montaj|thumbnail|hook|serie|canal|idee/i, 'Idei YouTube'],
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Offline stand-in for the FastAPI backend. Same contract, no network: it reads
 * the local category list so its answers stay consistent with what the user sees.
 */
export class MockApiClient implements ApiClient {
  readonly kind = 'mock' as const;

  private notesSeen = 0;
  private nextServerId = 900;

  async health(): Promise<boolean> {
    await sleep(120);
    return true;
  }

  async sync(payload: SyncPayload): Promise<SyncResponse> {
    await sleep(LATENCY_MS);

    for (let i = 0; i < payload.notes.length; i += 1) {
      this.notesSeen += 1;
      if (this.notesSeen % FAIL_EVERY === 0) {
        throw new ApiError('mock: simulated network failure');
      }
    }

    const categories = await this.currentCategories(payload);
    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

    const notes = payload.notes.map((n) => {
      if (!n.needs_categorization) {
        return { uuid: n.uuid, category_id: n.category_id ?? INBOX_ID, confidence: null, status: 'synced' as const };
      }
      const guess = RULES.find(([re]) => re.test(n.text))?.[1];
      // Confidence sits high on a keyword hit, low otherwise — mirrors the real
      // fallback: below the threshold the note goes to Inbox, never a wild guess.
      const confidence = guess ? 0.75 + Math.random() * 0.24 : Math.random() * 0.65;
      const target = guess ? byName.get(guess.toLowerCase()) : undefined;
      const categoryId = confidence >= CONFIDENCE_THRESHOLD && target ? target.id : INBOX_ID;
      return {
        uuid: n.uuid,
        category_id: categoryId,
        confidence: Number(confidence.toFixed(2)),
        status: 'synced' as const,
      };
    });

    return { notes, categories, category_refs: this.refs };
  }

  private refs: Record<string, number> = {};

  /** Assigns server ids to freshly created categories and returns the full list. */
  private async currentCategories(payload: SyncPayload): Promise<SyncCategoryOut[]> {
    this.refs = {};
    const local = await listCategories();
    // Deleted ones are gone from the local table already, so leaving them out is
    // automatic — except for Inbox, which the real server refuses to drop and
    // which must therefore survive here too, or the phone would take the
    // omission as an acknowledgement.
    const deleted = new Set(payload.deleted_categories.filter((id) => id !== INBOX_ID));
    const out: SyncCategoryOut[] = local
      .filter((c) => !c.pendingSync && !deleted.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, sort_order: c.sortOrder }));

    for (const created of payload.new_categories) {
      const existing = out.find((c) => c.name.toLowerCase() === created.name.toLowerCase());
      if (existing) {
        this.refs[created.local_ref] = existing.id;
        continue;
      }
      this.nextServerId += 1;
      this.refs[created.local_ref] = this.nextServerId;
      out.push({
        id: this.nextServerId,
        name: created.name,
        icon: created.icon,
        sort_order: out.length,
      });
    }
    return out;
  }
}

/**
 * Wire contract for POST /sync, mirroring backend/app/schemas.py.
 *
 * Field names are snake_case on purpose — this is the JSON that goes on the wire,
 * not app-internal state. Faza 05 swaps MockApiClient for HttpApiClient behind
 * this interface without touching the worker or the UI.
 */

export interface SyncNoteIn {
  uuid: string;
  text: string;
  category_id: number | null;
  done: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  needs_categorization: boolean;
}

export interface SyncCategoryIn {
  local_ref: string;
  name: string;
  icon: string;
}

export interface SyncPayload {
  notes: SyncNoteIn[];
  new_categories: SyncCategoryIn[];
  /**
   * Server ids of categories deleted on the phone. The server drops each one and
   * trashes its notes; ids it does not own, and Inbox, are ignored. Absence from
   * `SyncResponse.categories` is how the phone learns the deletion landed, which
   * is what makes a retried sync idempotent.
   */
  deleted_categories: number[];
}

export interface SyncNoteOut {
  uuid: string;
  category_id: number;
  confidence: number | null;
  status: 'synced' | 'error';
}

export interface SyncCategoryOut {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
}

export interface SyncResponse {
  notes: SyncNoteOut[];
  /** Always the user's full current list — the sidebar mirrors it. */
  categories: SyncCategoryOut[];
  /** local_ref -> server id, for categories created in this request. */
  category_refs: Record<string, number>;
}

export interface ApiClient {
  readonly kind: 'mock' | 'http';
  sync(payload: SyncPayload): Promise<SyncResponse>;
  health(): Promise<boolean>;
}

/** Thrown for anything the worker should retry with backoff. */
export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

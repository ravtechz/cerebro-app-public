export interface ParsedNoteText {
  /** The note text with the URL removed; empty when the note is only a link. */
  body: string;
  /** First URL found, or null. Kept verbatim — this is what gets opened. */
  url: string | null;
  /** Display host, without scheme or "www.". */
  host: string;
  /** Display path, including the leading slash. Empty for a bare domain. */
  path: string;
}

const URL_RE = /https?:\/\/[^\s]+/;

/**
 * Splits a note into prose and its first link, following the mockup: the raw URL
 * never renders inline — it becomes a compact host + path chip instead.
 */
export function parseNoteText(text: string): ParsedNoteText {
  const match = text.match(URL_RE);
  if (!match) return { body: text, url: null, host: '', path: '' };

  const url = match[0];
  const body = text.replace(url, '').replace(/\s+/g, ' ').trim();

  // Trailing punctuation is almost always sentence punctuation, not part of the URL.
  const bare = url.replace(/^https?:\/\//, '').replace(/[.,;:!?)]+$/, '').replace(/\/$/, '');
  const cut = bare.indexOf('/');
  const host = (cut === -1 ? bare : bare.slice(0, cut)).replace(/^www\./, '');
  const path = cut === -1 ? '' : bare.slice(cut);

  return { body, url, host, path };
}

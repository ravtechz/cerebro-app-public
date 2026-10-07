import { TRASH_RETENTION_DAYS } from '../types';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY_MS = 86_400_000;

/** Compact relative time, matching the mockup: "acum", "12m", "3h", "5z". */
export function ago(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'acum';
  const minutes = Math.round(seconds / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(seconds / HOUR);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}z`;
}

/** Romanian, no diacritics, three letters — same width for every month so the
 *  stamps line up in a monospaced list. */
const MONTHS = [
  'Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun',
  'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec',
] as const;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Absolute creation stamp: "16.Aug.2026->13:35".
 *
 * Zero-padded on purpose — in a monospaced column a single-digit day would
 * shift the whole line left and break the alignment down the list.
 */
export function stamp(iso: string): string {
  const d = new Date(iso);
  const date = `${pad(d.getDate())}.${MONTHS[d.getMonth()]}.${d.getFullYear()}`;
  return `${date}->${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "se sterge in 12 zile" — how long a trashed note has before the purge. */
export function trashHint(deletedAt: string, now: number = Date.now()): string {
  const elapsedDays = Math.floor((now - new Date(deletedAt).getTime()) / DAY_MS);
  const left = Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
  if (left === 0) return 'se sterge azi';
  return `se sterge in ${left} ${left === 1 ? 'zi' : 'zile'}`;
}

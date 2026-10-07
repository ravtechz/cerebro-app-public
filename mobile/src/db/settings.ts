import { DEFAULT_THEME_ID, isThemeId } from '../theme/themes';
import { isTextSize } from '../theme/tokens';
import type { Settings } from '../types';
import { getDb } from './client';

/**
 * Settings live in SQLite rather than AsyncStorage — one storage engine, and the
 * API key never leaves the app sandbox. Nothing here is ever hardcoded or bundled.
 */
export const DEFAULT_SETTINGS: Settings = {
  baseUrl: '',
  apiKey: '',
  connectionOk: false,
  textSize: 'medium',
  themeId: DEFAULT_THEME_ID,
};

export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT * FROM settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  // An unknown value would reach makeSize() and produce NaN font sizes — or, for
  // a theme, index into nothing at all — so both fall back rather than being
  // trusted. A theme dropped from the app leaves a row behind here.
  const storedSize = map.get('textSize');
  const storedTheme = map.get('themeId');
  return {
    baseUrl: map.get('baseUrl') ?? DEFAULT_SETTINGS.baseUrl,
    apiKey: map.get('apiKey') ?? DEFAULT_SETTINGS.apiKey,
    connectionOk: (map.get('connectionOk') ?? '0') === '1',
    textSize: storedSize && isTextSize(storedSize) ? storedSize : DEFAULT_SETTINGS.textSize,
    themeId: storedTheme && isThemeId(storedTheme) ? storedTheme : DEFAULT_SETTINGS.themeId,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDb();
  const entries: ReadonlyArray<[string, string]> = [
    ['baseUrl', settings.baseUrl.trim()],
    ['apiKey', settings.apiKey.trim()],
    ['connectionOk', settings.connectionOk ? '1' : '0'],
    ['textSize', settings.textSize],
    ['themeId', settings.themeId],
  ];
  await db.withTransactionAsync(async () => {
    for (const [key, value] of entries) {
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        key,
        value
      );
    }
  });
}

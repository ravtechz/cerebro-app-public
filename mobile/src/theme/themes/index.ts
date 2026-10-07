import type { Theme, ThemeId } from '../tokens';
import { almanac } from './almanac';
import { blush } from './blush';
import { nebula } from './nebula';
import { pastel } from './pastel';
import { synthwave } from './synthwave';

export const THEMES: Record<ThemeId, Theme> = {
  synthwave,
  blush,
  pastel,
  almanac,
  nebula,
};

/** Order the Settings dropdown lists them in: the original first, then dark last. */
export const THEME_IDS: readonly ThemeId[] = ['synthwave', 'blush', 'pastel', 'almanac', 'nebula'];

export const DEFAULT_THEME_ID: ThemeId = 'synthwave';

/**
 * A stored id that no longer exists would reach `makeSize` and produce NaN font
 * sizes, so the settings layer validates before trusting it.
 */
export const isThemeId = (value: string): value is ThemeId => value in THEMES;

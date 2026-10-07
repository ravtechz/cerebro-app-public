import { useStore } from '../store/useStore';
import { THEMES } from './themes';
import { makeSize, type Sizes, type Theme } from './tokens';

/**
 * Cached per (factory, theme, size) at module level rather than with `useMemo`:
 * a stylesheet depends only on those two settings, so every mounted NoteCard can
 * share one sheet instead of building its own.
 */
const cache = new WeakMap<object, Map<string, unknown>>();

/**
 * Resolves a stylesheet factory against the active theme and text size.
 *
 * `StyleSheet.create` runs at module load, so a plain `const styles = ...` can
 * never follow a runtime setting. Components therefore export a
 * `makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({...})` and call this.
 */
export function useStyles<T>(make: (theme: Theme, size: Sizes) => T): T {
  const theme = useTheme();
  const textSize = useStore((s) => s.settings.textSize);
  const key = `${theme.id}:${textSize}`;

  let byKey = cache.get(make);
  if (!byKey) {
    byKey = new Map();
    cache.set(make, byKey);
  }

  let styles = byKey.get(key);
  if (!styles) {
    styles = make(theme, makeSize(textSize, theme));
    byKey.set(key, styles);
  }

  return styles as T;
}

/**
 * The active theme, for the values a stylesheet cannot hold: icon colours,
 * `placeholderTextColor`, `keyboardAppearance`, anything passed as a prop.
 */
export function useTheme(): Theme {
  return THEMES[useStore((s) => s.settings.themeId)];
}

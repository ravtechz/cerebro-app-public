/**
 * Theme contract — the ONLY place colors, fonts, radii and glows are described.
 *
 * v1 shipped a single synthwave palette as module constants. Themes are a
 * runtime setting now, so nothing here is a colour: this file defines the shape
 * a theme must fill, plus the token groups that are the same in every theme
 * (spacing, layout, the size scale). The five themes live in `themes/`.
 *
 * Components never import a theme directly — `useStyles(makeStyles)` resolves
 * the active one, and `useTheme()` covers the inline cases (icon colours,
 * placeholder colours) that cannot go through a stylesheet.
 */

export type ThemeId = 'synthwave' | 'blush' | 'pastel' | 'almanac' | 'nebula';

export type Transform = 'uppercase' | 'lowercase' | 'none';

/**
 * iOS draws one shadow per view, so each theme's multi-layer CSS glow collapses
 * to a single set. `null` means the theme wants no shadow at all — Almanac is
 * printed paper and Blush is a soft drop, not a neon bloom.
 */
export interface BoxGlow {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export interface TextGlow {
  textShadowColor: string;
  textShadowOffset: { width: number; height: number };
  textShadowRadius: number;
}

export type NoteStatus = 'pending' | 'categorizing' | 'synced' | 'error';

export interface Theme {
  id: ThemeId;
  /** Shown in the Settings dropdown. */
  label: string;
  /** Drives the iOS status bar style and the keyboard appearance. */
  dark: boolean;
  /** `[background, accent, link]` — the three chips the Settings dropdown draws. */
  swatch: readonly [string, string, string];

  color: {
    bg: string;
    surface: string;
    /** A step below the surface: link previews, the logo tile's ground. */
    sunken: string;
    border: string;
    /** Slightly lifted border for controls that must read as tappable. */
    borderSoft: string;

    text: string;
    /** Note body — a touch below `text` so the card does not shout. */
    textDim: string;
    textMuted: string;
    textFaint: string;
    /** Third tier: section labels, counts, "necategorizat". */
    subtle: string;

    accent: string;
    /** Text/icon colour on top of `accent` or `link`. */
    accentInk: string;
    /** Secondary accent: links, carets, the send button. */
    link: string;

    /** The done → trash countdown. */
    warn: string;
    /** Errors: failed sync, form validation, "retry sync". */
    danger: string;

    scrim: string;
    /** Ground behind the logo mark in the sidebar. */
    logoTile: string;

    status: Record<NoteStatus, string>;
  };

  /**
   * Exact family names, not weights: a custom face plus `fontWeight` makes iOS
   * synthesise a bold or fall back to a system font, so every weight a theme
   * uses is loaded and named here.
   */
  font: { display: string; body: string; bodyBold: string };

  type: {
    /** Multiplier on the whole size scale — handwriting and serif need more px. */
    bodyScale: number;
    /** Extra multiplier for the display face, which reads smaller than Bungee. */
    displayScale: number;
    displayTransform: Transform;
    /**
     * Tracking multipliers, applied to the letter-spacing each site already
     * uses; `1` is the synthwave baseline. The softer themes track much tighter,
     * and a multiplier keeps that relative instead of re-stating px per site.
     */
    displayTracking: number;
    chipTransform: Transform;
    chipTracking: number;
    metaTransform: Transform;
    metaTracking: number;
  };

  /** Border width for cards, inputs and the sidebar edge. */
  border: number;

  radius: { sm: number; md: number; tile: number; chip: number; bar: number };

  glow: {
    /** On a card while it is being categorized. */
    card: BoxGlow | null;
    /**
     * Under the send button only. It is keyed to that button's colour (`link`),
     * so putting it under an `accent` button — "salveaza", "adauga" — tints the
     * wrong glow around it.
     */
    button: BoxGlow | null;
    /**
     * Under a note card while it is held in drag mode.
     *
     * The only glow that is not nullable: this one is not decoration but the
     * signal that the card left the page and is now under the finger. Even
     * Almanac, which is printed paper and refuses every other shadow, has to
     * cast one here — paper lifted off a desk does.
     */
    drag: BoxGlow;
    /** Around the logo tile. */
    tile: BoxGlow | null;
    /** Neon text: the wordmark, the unread badge. */
    text: TextGlow | null;
  };

  /** Blush and Pastel mark status with a band down the card's left edge. */
  statusBand: boolean;
  /** `[~]` / `[>]` belong to the terminal look; elsewhere the dot carries it. */
  statusGlyphs: boolean;
}

/**
 * Translucent variant of a theme colour. Takes `#RRGGBB` only — the rgba tokens
 * (`textDim`, `textFaint`, `scrim`, `borderSoft`) are already blended and must
 * not be passed in.
 */
export const withAlpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export type TextSize = 'small' | 'medium' | 'large';

/** `small` is the original v1.0.0 scale; `medium` is the default. */
export const TEXT_SIZE_SCALES: Record<TextSize, number> = {
  small: 1,
  medium: 1.15,
  large: 1.3,
};

export const TEXT_SIZES = Object.keys(TEXT_SIZE_SCALES) as readonly TextSize[];

export const isTextSize = (value: string): value is TextSize => value in TEXT_SIZE_SCALES;

/** The `small` synthwave scale, from which every other size is derived. */
const BASE = { micro: 8.5, tiny: 10, small: 11, body: 13, title: 15, logo: 18 } as const;

/** Half-point steps — anything finer renders blurry. */
const round = (value: number): number => Math.round(value * 2) / 2;

/**
 * Typography is built per (size × theme) rather than frozen at import: the user
 * picks the scale, the theme picks the faces, and each face needs its own px to
 * look the same weight on the page. Components take it through `useStyles`;
 * there is deliberately no static `size` export, so a stale consumer fails
 * typecheck.
 *
 * The `display*` entries are for `theme.font.display` only. They are separate
 * steps rather than a factor applied at the call site so the display face cannot
 * be scaled by accident.
 */
export const makeSize = (textSize: TextSize, theme: Theme) => {
  const k = TEXT_SIZE_SCALES[textSize] * theme.type.bodyScale;
  const d = k * theme.type.displayScale;
  return {
    micro: round(BASE.micro * k),
    tiny: round(BASE.tiny * k),
    small: round(BASE.small * k),
    body: round(BASE.body * k),
    displaySmall: round(BASE.small * d),
    displayTitle: round(BASE.title * d),
    displayLogo: round(BASE.logo * d),
  } as const;
};

export type Sizes = ReturnType<typeof makeSize>;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const layout = {
  sidebarOpen: 214,
  sidebarClosed: 58,
  sidebarAnimMs: 280,
  sidebarIcon: 24,
  checkbox: 19,
  sendButton: 38,
  /** Width of the status band Blush and Pastel draw down the card's left edge. */
  statusBand: 4,

  /**
   * Hold this long on a note before it lifts into drag mode.
   *
   * Shorter than the ~500ms iOS uses for context menus on purpose: the note list
   * has nothing else bound to a long press, so there is no gesture to
   * disambiguate from, and a snappier arm makes the mode feel deliberate rather
   * than sluggish.
   */
  dragHoldMs: 320,
  /** Finger travel that cancels the hold — under this it is still a press. */
  dragSlop: 8,
  /** How much the lifted card grows and tilts while it is under the finger. */
  dragScale: 1.04,
  dragTilt: '1.5deg',
  /** Spring-back when a drag ends on nothing. */
  dragReturnMs: 180,
} as const;

/**
 * What each note status says. The colour is not here — it comes from
 * `theme.color.status`, because that is the part every theme redefines.
 *
 * Mapping follows the original Faza 01 spec (pending = yellow, error = red)
 * for synthwave; the other themes use their own `--st-*` tokens.
 */
export const statusMeta: Record<NoteStatus, { label: string; glyph: string; pulse: boolean }> = {
  pending: { label: 'pending', glyph: '[~]', pulse: true },
  categorizing: { label: 'categorizing', glyph: '[>]', pulse: true },
  synced: { label: 'synced', glyph: '[✓]', pulse: false },
  error: { label: 'error', glyph: '[!]', pulse: false },
};

/**
 * The done → trash countdown. Not a `NoteStatus`: it is a transient UI state
 * that temporarily takes over the status slot, so it stays out of `statusMeta`.
 *
 * It borrows `theme.color.warn` rather than a status colour — `categorizing`
 * already pulses, and one colour carrying two meanings would read as a bug.
 */
export const trashCountdown = { glyph: '[→]', label: 'in trash' } as const;

/**
 * Bracket glyphs are terminal furniture, and the softer themes drop them — the
 * pulsing dot already says the same thing. Excalifont has no `✓` or `→` either,
 * so this is not only a matter of taste.
 */
export const glyphPrefix = (theme: Theme, glyph: string): string =>
  theme.statusGlyphs ? `${glyph} ` : '';

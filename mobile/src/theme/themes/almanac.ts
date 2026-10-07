import type { Theme } from '../tokens';

/**
 * Warm paper, editorial — Instrument Serif over Newsreader. The one theme with
 * no glow anywhere and no pill: `radius.chip` is 4, not 999, so buttons stay
 * squared off like set type. Its display face reads smallest of the five, hence
 * the 1.615 display scale.
 */
export const almanac: Theme = {
  id: 'almanac',
  label: 'Almanac',
  dark: false,
  swatch: ['#F3EEE4', '#B4471F', '#1F6F5C'],

  color: {
    bg: '#F3EEE4',
    surface: '#FBF8F1',
    sunken: '#EBE3D4',
    border: '#DBD1BE',
    borderSoft: 'rgba(219,209,190,0.9)',

    text: '#2B2A26',
    textDim: 'rgba(43,42,38,0.92)',
    textMuted: '#6E6656',
    textFaint: 'rgba(43,42,38,0.45)',
    subtle: '#8C8574',

    accent: '#B4471F',
    accentInk: '#FBF8F1',
    link: '#1F6F5C',

    warn: '#B8891C',
    danger: '#B8891C',

    scrim: 'rgba(43,42,38,0.24)',
    logoTile: '#EBE3D4',

    status: {
      pending: '#8C8574',
      categorizing: '#1F6F5C',
      synced: '#B4471F',
      error: '#B8891C',
    },
  },

  font: {
    display: 'InstrumentSerif_400Regular',
    body: 'Newsreader_400Regular',
    bodyBold: 'Newsreader_600SemiBold',
  },

  type: {
    bodyScale: 1.154,
    displayScale: 1.615,
    displayTransform: 'none',
    displayTracking: 0.25,
    chipTransform: 'uppercase',
    chipTracking: 0.714,
    metaTransform: 'none',
    metaTracking: 0.143,
  },

  border: 1,
  radius: { sm: 2, md: 3, tile: 2, chip: 4, bar: 4 },

  glow: {
    card: {
      shadowColor: '#2B2A26',
      shadowOpacity: 0.1,
      shadowRadius: 1,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    // The one shadow this theme allows itself. A card at rest is ink on paper
    // and casts the 1px hairline above; a card held in the hand is off the page.
    drag: {
      shadowColor: '#2B2A26',
      shadowOpacity: 0.24,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    button: null,
    tile: null,
    text: null,
  },

  statusBand: false,
  statusGlyphs: false,
};

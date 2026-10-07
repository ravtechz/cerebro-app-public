import type { Theme } from '../tokens';

/**
 * White + pink, hand-drawn. Everything is Excalifont — display and body — which
 * is why the whole scale is 15% larger: handwriting reads smaller than a mono at
 * the same px. It has a single 400 weight, so `bodyBold` is the same face.
 *
 * Bundled locally (SIL OFL 1.1, see assets/fonts/Excalifont-LICENSE.txt); it is
 * not on Google Fonts.
 */
export const blush: Theme = {
  id: 'blush',
  label: 'Blush',
  dark: false,
  swatch: ['#FFF6FA', '#FF5C9E', '#B857D6'],

  color: {
    bg: '#FFF6FA',
    surface: '#FFFFFF',
    sunken: '#FFF0F6',
    border: '#F2DBE6',
    borderSoft: 'rgba(242,219,230,0.9)',

    text: '#4A2C3D',
    textDim: 'rgba(74,44,61,0.92)',
    textMuted: '#8C6B7C',
    textFaint: 'rgba(74,44,61,0.45)',
    subtle: '#B9A0AE',

    accent: '#FF5C9E',
    accentInk: '#FFFFFF',
    link: '#B857D6',

    warn: '#E8823C',
    danger: '#E8823C',

    scrim: 'rgba(74,44,61,0.26)',
    logoTile: '#FFF0F6',

    status: {
      pending: '#B9A0AE',
      categorizing: '#8B6BE0',
      synced: '#FF5C9E',
      error: '#E8823C',
    },
  },

  font: {
    display: 'Excalifont_400Regular',
    body: 'Excalifont_400Regular',
    bodyBold: 'Excalifont_400Regular',
  },

  type: {
    bodyScale: 1.154,
    displayScale: 1.462,
    displayTransform: 'none',
    displayTracking: 0,
    chipTransform: 'lowercase',
    chipTracking: 0.143,
    metaTransform: 'lowercase',
    metaTracking: 0.143,
  },

  border: 1,
  radius: { sm: 8, md: 16, tile: 11, chip: 999, bar: 24 },

  glow: {
    card: {
      shadowColor: '#FF5C9E',
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    button: {
      shadowColor: '#B857D6',
      shadowOpacity: 0.38,
      shadowRadius: 7,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    drag: {
      shadowColor: '#FF5C9E',
      shadowOpacity: 0.32,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
    },
    tile: null,
    text: null,
  },

  statusBand: true,
  statusGlyphs: false,
};

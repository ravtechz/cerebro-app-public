import type { Theme } from '../tokens';

/**
 * Cream + indigo, rounded, all Nunito. The only theme with a 1.5px border: it
 * carries the whole card at this weight, since the shadow is nearly invisible.
 */
export const pastel: Theme = {
  id: 'pastel',
  label: 'Pastel',
  dark: false,
  swatch: ['#F8F5EF', '#6C5CE7', '#2E9E77'],

  color: {
    bg: '#F8F5EF',
    surface: '#FFFFFF',
    sunken: '#F1EEFF',
    border: '#E6E0D4',
    borderSoft: 'rgba(230,224,212,0.9)',

    text: '#2F2A24',
    textDim: 'rgba(47,42,36,0.92)',
    textMuted: '#7C7568',
    textFaint: 'rgba(47,42,36,0.42)',
    subtle: '#A79F90',

    accent: '#6C5CE7',
    accentInk: '#FFFFFF',
    link: '#6C5CE7',

    warn: '#D9822B',
    danger: '#D9822B',

    scrim: 'rgba(47,42,36,0.22)',
    logoTile: '#F1EEFF',

    status: {
      pending: '#A79F90',
      categorizing: '#6C5CE7',
      synced: '#2E9E77',
      error: '#D9822B',
    },
  },

  font: {
    display: 'Nunito_800ExtraBold',
    body: 'Nunito_400Regular',
    bodyBold: 'Nunito_700Bold',
  },

  type: {
    bodyScale: 1.077,
    displayScale: 1.385,
    displayTransform: 'none',
    displayTracking: -0.25,
    chipTransform: 'uppercase',
    chipTracking: 0.714,
    metaTransform: 'uppercase',
    metaTracking: 0.714,
  },

  border: 1.5,
  radius: { sm: 7, md: 14, tile: 10, chip: 999, bar: 16 },

  glow: {
    card: {
      shadowColor: '#2F2A24',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    button: {
      shadowColor: '#6C5CE7',
      shadowOpacity: 0.28,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    drag: {
      shadowColor: '#2F2A24',
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    tile: null,
    text: null,
  },

  statusBand: true,
  statusGlyphs: false,
};

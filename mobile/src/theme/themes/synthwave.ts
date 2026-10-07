import type { Theme } from '../tokens';

/**
 * The v1 look, unchanged — synthwave / retro-terminal, as in
 * cerebro-mobile-mockup.html. Its tracking multipliers are all `1` because
 * every other theme's tracking is expressed relative to this one.
 */
export const synthwave: Theme = {
  id: 'synthwave',
  label: 'Synthwave',
  dark: true,
  swatch: ['#241B2F', '#FF7EDB', '#36F9F6'],

  color: {
    bg: '#241B2F',
    surface: '#2D2440',
    sunken: '#17111F',
    border: '#34294F',
    borderSoft: 'rgba(66,54,89,0.9)',

    text: '#F8F8F2',
    textDim: 'rgba(248,248,242,0.92)',
    textMuted: '#B6B1B9',
    textFaint: 'rgba(248,248,242,0.35)',
    subtle: '#848BBD',

    accent: '#FF7EDB',
    accentInk: '#241B2F',
    link: '#36F9F6',

    warn: '#FEDE5D',
    danger: '#FE4450',

    scrim: 'rgba(26,20,34,0.62)',
    // Sits between surface and the deep background — dark enough to ground a
    // neon mark without punching a black hole through the sidebar.
    logoTile: '#221A30',

    status: {
      pending: '#FEDE5D',
      categorizing: '#36F9F6',
      synced: '#FF7EDB',
      error: '#FE4450',
    },
  },

  font: {
    display: 'Bungee_400Regular',
    body: 'SpaceMono_400Regular',
    bodyBold: 'SpaceMono_700Bold',
  },

  type: {
    bodyScale: 1,
    displayScale: 1,
    displayTransform: 'uppercase',
    displayTracking: 1,
    chipTransform: 'uppercase',
    chipTracking: 1,
    metaTransform: 'uppercase',
    metaTracking: 1,
  },

  border: 1,
  radius: { sm: 5, md: 10, tile: 7, chip: 999, bar: 26 },

  glow: {
    card: {
      shadowColor: '#36F9F6',
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    button: {
      shadowColor: '#36F9F6',
      shadowOpacity: 0.36,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    drag: {
      shadowColor: '#36F9F6',
      shadowOpacity: 0.55,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 14,
    },
    tile: {
      shadowColor: '#FF7EDB',
      shadowOpacity: 0.36,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    text: {
      textShadowColor: 'rgba(54,249,246,0.42)',
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 10,
    },
  },

  statusBand: false,
  statusGlyphs: true,
};

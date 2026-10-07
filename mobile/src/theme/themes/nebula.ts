import type { Theme } from '../tokens';

/**
 * Indigo + mint — Space Grotesk over JetBrains Mono. The mono is wide, so this
 * is the one theme that scales *down* (0.962).
 *
 * Its designed card highlight is a 1px mint ring, which RN cannot draw as a
 * shadow; it becomes a tight mint glow of the same colour and weight instead.
 */
export const nebula: Theme = {
  id: 'nebula',
  label: 'Nebula',
  dark: true,
  swatch: ['#0E1220', '#7C8CFF', '#5FE3C0'],

  color: {
    bg: '#0E1220',
    surface: '#161C2E',
    sunken: '#0A0E1A',
    border: '#242C44',
    borderSoft: 'rgba(36,44,68,0.9)',

    text: '#E7EAF3',
    textDim: 'rgba(231,234,243,0.92)',
    textMuted: '#8D97B4',
    textFaint: 'rgba(231,234,243,0.32)',
    subtle: '#6C7796',

    accent: '#7C8CFF',
    accentInk: '#0E1220',
    link: '#5FE3C0',

    warn: '#FF8A7A',
    danger: '#FF8A7A',

    scrim: 'rgba(10,14,26,0.66)',
    logoTile: '#0A0E1A',

    status: {
      pending: '#6C7796',
      categorizing: '#5FE3C0',
      synced: '#7C8CFF',
      error: '#FF8A7A',
    },
  },

  font: {
    display: 'SpaceGrotesk_700Bold',
    body: 'JetBrainsMono_400Regular',
    bodyBold: 'JetBrainsMono_700Bold',
  },

  type: {
    bodyScale: 0.962,
    displayScale: 1.308,
    displayTransform: 'none',
    displayTracking: -0.25,
    chipTransform: 'uppercase',
    chipTracking: 0.714,
    metaTransform: 'uppercase',
    metaTracking: 0.714,
  },

  border: 1,
  radius: { sm: 6, md: 12, tile: 8, chip: 999, bar: 14 },

  glow: {
    card: {
      shadowColor: '#5FE3C0',
      shadowOpacity: 0.38,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    button: {
      shadowColor: '#5FE3C0',
      shadowOpacity: 0.32,
      shadowRadius: 9,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    drag: {
      shadowColor: '#5FE3C0',
      shadowOpacity: 0.5,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    tile: null,
    text: null,
  },

  statusBand: false,
  statusGlyphs: false,
};

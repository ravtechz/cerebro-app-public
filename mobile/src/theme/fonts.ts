// Imported by subpath, not from the package roots: a root index.js require()s
// every weight it ships, which drags unused italics into the bundle.
import { Bungee_400Regular } from '@expo-google-fonts/bungee/400Regular';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { Newsreader_600SemiBold } from '@expo-google-fonts/newsreader/600SemiBold';
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono/400Regular';
import { SpaceMono_700Bold } from '@expo-google-fonts/space-mono/700Bold';

/**
 * Every face any theme names, loaded in one pass at startup.
 *
 * Lazily loading only the active theme's faces would save a few hundred
 * kilobytes of registration but make switching theme flash unstyled text, and
 * the files are bundled either way — there is no download to defer.
 *
 * Keys are the family names `Theme.font` refers to; each must match a
 * `fontFamily` string in `themes/`.
 */
export const FONTS = {
  Bungee_400Regular,
  SpaceMono_400Regular,
  SpaceMono_700Bold,
  Nunito_400Regular,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  InstrumentSerif_400Regular,
  Newsreader_400Regular,
  Newsreader_600SemiBold,
  SpaceGrotesk_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_700Bold,
  // Not on Google Fonts, so it ships as a repo asset — converted to ttf from
  // the woff2 the theme mockups carried, because iOS takes ttf/otf only.
  // SIL OFL 1.1; the licence sits beside the file.
  Excalifont_400Regular: require('../../assets/fonts/Excalifont-Regular.ttf'),
};

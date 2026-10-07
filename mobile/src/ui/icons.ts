import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export { MaterialIcons };

type GlyphName = keyof typeof MaterialIcons.glyphMap;

/**
 * Categories store Material Symbol names (`smart_display`), which is what the
 * backend and the web app in Faza 06 will use too. MaterialIcons uses the same
 * vocabulary with dashes, so the adapter is a rename plus a safety net.
 */
export function iconFor(symbolName: string): GlyphName {
  const candidate = symbolName.trim().replace(/_/g, '-') as GlyphName;
  return candidate in MaterialIcons.glyphMap ? candidate : 'category';
}

/**
 * Icon choices offered by the "Add Category" dialog, grouped by theme so the
 * grid reads coherently while scrolling. Every name is verified to resolve in
 * the MaterialIcons glyph map — `iconFor` falls back to 'category' regardless.
 */
export const ICON_CHOICES: ReadonlyArray<string> = [
  // organizare
  'category', 'inbox', 'star', 'favorite', 'check_circle', 'lightbulb',
  'event', 'calendar_month', 'schedule', 'alarm', 'notifications', 'description',
  'format_quote',
  // citit & scris
  'book', 'menu_book', 'newspaper', 'school', 'language',
  // media & creatie
  'smart_display', 'movie', 'theaters', 'tv', 'podcasts', 'music_note',
  'headphones', 'mic', 'camera_alt', 'palette', 'brush',
  'videogame_asset', 'sports_esports', 'sports_soccer',
  // munca & tech
  'work', 'code', 'terminal', 'build', 'handyman', 'bug_report', 'extension',
  'cloud', 'wifi', 'security', 'lock', 'key', 'campaign', 'group', 'chat', 'phone',
  // bani & cumparaturi
  'attach_money', 'savings', 'credit_card', 'receipt', 'shopping_cart',
  'shopping_bag', 'local_grocery_store',
  // sanatate & minte
  'fitness_center', 'self_improvement', 'spa', 'psychology', 'medical_services',
  'science', 'water_drop',
  // mancare & social
  'restaurant', 'local_cafe', 'local_bar', 'local_florist', 'celebration',
  'emoji_events',
  // calatorii & afara
  'flight', 'hotel', 'map', 'public', 'hiking', 'park', 'sailing',
  'directions_car', 'directions_bike', 'rocket_launch', 'nights_stay', 'wb_sunny',
  // casa & altele
  'home', 'pets', 'gavel', 'watch',
];

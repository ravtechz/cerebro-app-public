import { Pressable, StyleSheet, Text, View } from 'react-native';

import { space, type Sizes, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import { MaterialIcons } from '../ui/icons';

export interface HeaderAction {
  /**
   * Outline glyphs only. The header is line art — the hamburger, the wordmark's
   * stroke weight — and a solid Material glyph like `folder-delete` renders as
   * a filled block at 18px, which next to them reads as a smudge rather than an
   * icon.
   */
  icon: 'delete-sweep' | 'playlist-add-check' | 'delete-outline';
  label: string;
  onPress: () => void;
}

interface Props {
  title: string;
  count: number;
  /** Rendered in order, between the title and the note count. */
  actions?: readonly HeaderAction[];
  onToggleSidebar: () => void;
}

export function Header({ title, count, actions, onToggleSidebar }: Props) {
  const t = useTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.header}>
      <Pressable onPress={onToggleSidebar} hitSlop={12} style={styles.menu}>
        <MaterialIcons name="menu" size={22} color={t.color.textMuted} />
      </Pressable>

      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>

      {(actions ?? []).map((action) => (
        <Pressable
          key={action.icon}
          onPress={action.onPress}
          hitSlop={10}
          accessibilityLabel={action.label}
          style={styles.action}
        >
          {/* Every action here is muted, destructive ones included: the header
              is chrome, and the confirmation dialog is where the warning
              belongs. A red glyph sitting there permanently draws the eye to a
              button nobody should be pressing often. */}
          <MaterialIcons name={action.icon} size={18} color={t.color.textMuted} />
        </Pressable>
      ))}

      <Text style={styles.count}>
        {count} {count === 1 ? 'nota' : 'note'}
      </Text>
    </View>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomColor: t.color.border,
    borderBottomWidth: t.border,
  },
  menu: { padding: 2 },
  title: {
    flex: 1,
    fontFamily: t.font.display,
    // No fontWeight: each theme's display face is loaded at the one weight it
    // wants, and asking for 700 on top makes iOS synthesise a bold or fall back
    // to a system face.
    fontSize: size.displayTitle,
    // Bungee is already wide; the 2.2 that suited Space Mono over-tracked it,
    // and the softer faces pull it back further still.
    letterSpacing: 1 * t.type.displayTracking,
    textTransform: t.type.displayTransform,
    color: t.color.text,
  },
  action: { padding: 2 },
  count: { fontFamily: t.font.body, fontSize: size.tiny, color: t.color.textMuted },
});

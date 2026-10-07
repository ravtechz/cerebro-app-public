import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { unlessDragged } from '../drag/tapGuard';
import { space, withAlpha, type Sizes, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import { MaterialIcons } from '../ui/icons';

interface Props {
  url: string;
  host: string;
  path: string;
  dimmed: boolean;
}

/**
 * Compact, tappable stand-in for a raw URL: host on top, path underneath,
 * both clipped to one line so a long link can never blow up the card.
 *
 * Deliberately offline — it renders only what the URL itself already says. A
 * real page preview (title, thumbnail) would need a network fetch on render,
 * which local-first rules out for Faza 01.
 */
export function LinkPreview({ url, host, path, dimmed }: Props) {
  const t = useTheme();
  const styles = useStyles(makeStyles);

  // Guarded because this one leaves the app: holding a note to move it and
  // letting go over the link would open a browser instead.
  const open = unlessDragged(() => {
    void Linking.openURL(url).catch(() => {
      /* nothing sensible to do on a malformed URL — the note text still has it */
    });
  });

  return (
    <Pressable onPress={open} style={[styles.card, dimmed && styles.dimmed]} hitSlop={4}>
      <View style={styles.iconWrap}>
        <MaterialIcons name="link" size={16} color={t.color.link} />
      </View>
      <View style={styles.textWrap}>
        <Text numberOfLines={1} style={styles.host}>
          {host}
        </Text>
        {path ? (
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.path}>
            {path}
          </Text>
        ) : null}
      </View>
      <MaterialIcons name="open-in-new" size={14} color={t.color.subtle} />
    </Pressable>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: t.color.sunken,
    borderColor: withAlpha(t.color.link, 0.28),
    borderWidth: t.border,
    borderRadius: t.radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginTop: 2,
  },
  dimmed: { opacity: 0.5 },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: t.radius.sm,
    backgroundColor: withAlpha(t.color.link, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  host: { fontFamily: t.font.bodyBold, fontSize: size.small, color: t.color.link },
  path: { fontFamily: t.font.body, fontSize: size.tiny, color: t.color.textMuted, marginTop: 1 },
});

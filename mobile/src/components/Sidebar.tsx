import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DropTarget } from '../drag/useNoteDrag';
import { layout, makeSize, space, withAlpha, type Sizes, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import type { Category, View as AppView } from '../types';
import { MaterialIcons, iconFor } from '../ui/icons';
import { VERSION_LABEL } from '../version';

const LOGO = require('../../assets/logo.png');

export interface SidebarHandle {
  /** Where each category row currently sits, for the drag & drop hit test. */
  measureTargets: () => Promise<DropTarget[]>;
}

interface Props {
  open: boolean;
  categories: Category[];
  counts: Map<number, number>;
  /** Per category, how many notes arrived since it was last opened. */
  newCounts: Map<number, number>;
  trashCount: number;
  view: AppView;
  /** A note is in the air: category rows become drop zones, the rest step back. */
  dragging: boolean;
  /** The category row under the finger, if any. */
  hoverId: number | null;
  onPick: (view: AppView) => void;
  onAddCategory: () => void;
  onOpenSettings: () => void;
}

export const Sidebar = forwardRef<SidebarHandle, Props>(function Sidebar(
  {
    open,
    categories,
    counts,
    newCounts,
    trashCount,
    view,
    dragging,
    hoverId,
    onPick,
    onAddCategory,
    onOpenSettings,
  },
  ref
) {
  const t = useTheme();
  const styles = useStyles(makeStyles);

  const rows = useRef(new Map<number, View | null>()).current;
  const frame = useRef<View>(null);

  /**
   * Rows are measured when a drag begins rather than tracked with `onLayout`,
   * because only `measureInWindow` speaks the same coordinates as the finger.
   *
   * Rows scrolled out of the list still measure, and would answer for a band of
   * screen the user cannot see — so each one is clipped to the visible frame and
   * dropped if nothing is left. Without that, a long category list puts phantom
   * targets over the wordmark.
   */
  useImperativeHandle(
    ref,
    () => ({
      measureTargets: async () => {
        const bounds = await measure(frame.current);
        if (bounds === null) return [];
        const measured = await Promise.all(
          [...rows.entries()].map(async ([categoryId, node]): Promise<DropTarget | null> => {
            const box = await measure(node);
            if (box === null) return null;
            const top = Math.max(box.top, bounds.top);
            const bottom = Math.min(box.bottom, bounds.bottom);
            return bottom - top < 1 ? null : { categoryId, top, bottom };
          })
        );
        return measured.filter((target): target is DropTarget => target !== null);
      },
    }),
    [rows]
  );

  const width = useRef(new Animated.Value(open ? layout.sidebarOpen : layout.sidebarClosed)).current;
  const labelOpacity = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(width, {
        toValue: open ? layout.sidebarOpen : layout.sidebarClosed,
        duration: layout.sidebarAnimMs,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: false,
      }),
      Animated.timing(labelOpacity, {
        toValue: open ? 1 : 0,
        duration: layout.sidebarAnimMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, width, labelOpacity]);

  const isActive = (v: AppView): boolean =>
    v.kind === 'trash' ? view.kind === 'trash' : view.kind === 'category' && view.categoryId === v.categoryId;

  const renderRow = (
    key: string,
    icon: string,
    label: string,
    count: number,
    target: AppView,
    newCount = 0
  ) => {
    const active = isActive(target);
    // Only categories can receive a note. Trash is a destination for a whole
    // different gesture — ticking the note — and pretending otherwise here would
    // offer a drop that silently does nothing.
    const dropId = target.kind === 'category' ? target.categoryId : null;
    const hovered = dropId !== null && dropId === hoverId;
    const inert = dragging && dropId === null;
    // Unread wins over active only in colour: the row you are on cannot be
    // unread anyway, since opening it is what clears the badge.
    const tint = hovered
      ? t.color.accent
      : newCount > 0
        ? t.color.link
        : active
          ? t.color.accent
          : t.color.text;
    return (
      <Pressable
        key={key}
        ref={
          dropId === null
            ? undefined
            : (node) => {
                rows.set(dropId, node);
              }
        }
        onPress={() => onPick(target)}
        style={[
          styles.row,
          active && styles.rowActive,
          hovered && styles.rowDrop,
          inert && styles.rowInert,
        ]}
      >
        <View style={[styles.activeBar, (active || hovered) && styles.activeBarOn]} />
        {/* The badge lives on the icon, not next to the label: the label sits in
            an Animated.View faded to 0 while the rail is collapsed, which is the
            default state — a badge in there would be invisible exactly when it
            matters most. */}
        <View style={styles.iconSlot}>
          <MaterialIcons
            name={iconFor(icon)}
            size={layout.sidebarIcon}
            color={tint}
            style={newCount > 0 ? (t.glow.text ?? undefined) : undefined}
          />
          {newCount > 0 ? (
            <Text style={styles.badge} numberOfLines={1}>
              ({newCount})
            </Text>
          ) : null}
        </View>
        <Animated.View style={[styles.rowLabel, { opacity: labelOpacity }]}>
          <Text
            numberOfLines={1}
            style={[styles.rowText, (active || hovered) && { color: t.color.accent }]}
          >
            {label}
          </Text>
          {count > 0 ? <Text style={styles.count}>{count}</Text> : null}
        </Animated.View>
      </Pressable>
    );
  };

  return (
    <Animated.View style={[styles.sidebar, { width }]}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Image source={LOGO} style={styles.logoImage} resizeMode="contain" />
        </View>
        {/* Wordmark and version fade as one block — the version belongs to the
            name, not to the list below it. */}
        <Animated.View style={[styles.brandLabel, { opacity: labelOpacity }]}>
          {/* Written in title case and cased by the theme: synthwave shouts it
              in Bungee, the others sign it. */}
          <Text numberOfLines={1} style={styles.brandText}>
            Cerebro
          </Text>
          <Text numberOfLines={1} style={styles.version}>
            {VERSION_LABEL}
          </Text>
        </Animated.View>
      </View>

      {/* A plain view around the list purely so its visible bounds can be
          measured — rows are clipped to it before they count as drop targets. */}
      <View ref={frame} collapsable={false} style={styles.frame}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          <Animated.Text style={[styles.sectionLabel, { opacity: labelOpacity }]}>
            categorii
          </Animated.Text>
          {categories.map((c) =>
            renderRow(
              `c${c.id}`,
              c.icon,
              c.name,
              counts.get(c.id) ?? 0,
              { kind: 'category', categoryId: c.id },
              newCounts.get(c.id) ?? 0
            )
          )}

          <View style={styles.separator} />
          {renderRow('trash', 'delete', 'Trash', trashCount, { kind: 'trash' })}

          <Pressable onPress={onAddCategory} style={[styles.row, dragging && styles.rowInert]}>
            <View style={styles.activeBar} />
            <View style={styles.iconSlot}>
              <MaterialIcons name="add" size={layout.sidebarIcon} color={t.color.link} />
            </View>
            <Animated.View style={[styles.rowLabel, { opacity: labelOpacity }]}>
              <Text numberOfLines={1} style={[styles.rowText, { color: t.color.link }]}>
                Add Category
              </Text>
            </Animated.View>
          </Pressable>
        </ScrollView>
      </View>

      <Pressable
        onPress={onOpenSettings}
        style={[styles.row, styles.settingsRow, dragging && styles.rowInert]}
      >
        <View style={styles.activeBar} />
        <View style={styles.iconSlot}>
          <MaterialIcons name="settings" size={layout.sidebarIcon} color={t.color.text} />
        </View>
        <Animated.View style={[styles.rowLabel, { opacity: labelOpacity }]}>
          <Text numberOfLines={1} style={styles.rowText}>
            Settings
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

/** Promise wrapper over `measureInWindow`, which answers through a callback. */
function measure(node: View | null): Promise<{ top: number; bottom: number } | null> {
  return new Promise((resolve) => {
    if (node === null) {
      resolve(null);
      return;
    }
    node.measureInWindow((_x, y, _width, height) => {
      resolve(height === 0 ? null : { top: y, bottom: y + height });
    });
  });
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  sidebar: {
    backgroundColor: t.color.surface,
    borderRightColor: t.color.border,
    borderRightWidth: t.border,
    overflow: 'hidden',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: (layout.sidebarClosed - 30) / 2,
    paddingRight: space.md,
    paddingVertical: space.lg,
  },
  logo: {
    width: 30,
    height: 30,
    borderRadius: t.radius.tile,
    // A shade off the sidebar rather than a hard cut-out: the mark is a saturated
    // gradient and needs its own ground, dark or light, to read against.
    backgroundColor: t.color.logoTile,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...(t.glow.tile ?? {}),
  },
  logoImage: { width: '100%', height: '100%' },
  brandLabel: { flexShrink: 1 },
  version: {
    fontFamily: t.font.body,
    fontSize: size.micro,
    letterSpacing: 0.8 * t.type.metaTracking,
    color: t.color.textFaint,
    marginTop: 1,
  },
  brandText: {
    fontFamily: t.font.display,
    fontSize: size.displayLogo,
    // No tracking here, unlike the header title: Bungee shipped untracked at this
    // size, and what the themes would add or remove is under half a pixel.
    textTransform: t.type.displayTransform,
    color: t.color.link,
    ...(t.glow.text ?? {}),
  },
  list: { paddingBottom: space.md },
  sectionLabel: {
    fontFamily: t.font.body,
    fontSize: size.micro,
    letterSpacing: 1.6 * t.type.metaTracking,
    textTransform: t.type.metaTransform,
    color: t.color.subtle,
    paddingLeft: space.lg,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    paddingRight: space.md,
  },
  frame: { flex: 1 },
  rowActive: { backgroundColor: withAlpha(t.color.accent, 0.1) },
  /** Louder than `rowActive` on purpose — the two can be the same row. */
  rowDrop: { backgroundColor: withAlpha(t.color.accent, 0.24) },
  /** Everything a note cannot be dropped on, while one is in the air. */
  rowInert: { opacity: 0.3 },
  activeBar: { width: 2, height: 24, borderRadius: 1, backgroundColor: 'transparent' },
  activeBarOn: { backgroundColor: t.color.accent },
  // Fills the rest of the collapsed rail so the icon sits on its centre line,
  // whether the sidebar is open or closed.
  iconSlot: {
    width: layout.sidebarClosed - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    // Clipping the icon's top-right corner. It cannot sit fully beside the icon
    // — "(12)" beside a 24px glyph does not fit a 58px rail — so it overlaps,
    // and carries its own background to stay legible over a coloured glyph.
    top: 2,
    left: '50%',
    marginLeft: 4,
    paddingHorizontal: 2,
    borderRadius: t.radius.sm,
    overflow: 'hidden',
    backgroundColor: t.color.sunken,
    fontFamily: t.font.bodyBold,
    // The badge is chrome, not content, and it has to fit beside a 24px icon
    // inside a 58px rail — so it pins to the smallest scale instead of following
    // the user's text size. At `large` it would outgrow the collapsed sidebar.
    fontSize: makeSize('small', t).micro,
    color: t.color.link,
    ...(t.glow.text ?? {}),
  },
  rowLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowText: { flex: 1, fontFamily: t.font.bodyBold, fontSize: size.small, color: t.color.textMuted },
  count: { fontFamily: t.font.body, fontSize: size.tiny, color: t.color.subtle },
  separator: {
    height: 1,
    backgroundColor: t.color.border,
    marginVertical: space.sm,
    marginHorizontal: space.md,
  },
  settingsRow: {
    borderTopColor: t.color.border,
    borderTopWidth: 1,
    height: 58,
    marginBottom: space.lg,
  },
});

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { THEMES, THEME_IDS } from '../theme/themes';
import { space, type Sizes, type Theme, type ThemeId } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import { MaterialIcons } from '../ui/icons';

interface Props {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
}

/**
 * Theme picker: a closed field that opens a list of the five themes.
 *
 * A real dropdown rather than a row of buttons because the list will keep
 * growing, and a Modal rather than an absolutely positioned panel because
 * Settings is a ScrollView — an overlay inside it would be clipped and would
 * scroll away from its field.
 *
 * Each row carries the theme's own three colours instead of rendering itself in
 * that theme: five typefaces in one list reads as a broken screen, and the
 * swatch is what actually distinguishes them at a glance. The preview card below
 * shows the chosen one in full.
 */
export function ThemeDropdown({ value, onChange }: Props) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);

  const pick = (id: ThemeId) => {
    setOpen(false);
    onChange(id);
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.field}>
        <Swatch colors={THEMES[value].swatch} />
        <Text style={styles.fieldText}>{THEMES[value].label}</Text>
        <MaterialIcons name="expand-more" size={20} color={t.color.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {THEME_IDS.map((id) => {
              const active = id === value;
              return (
                <Pressable
                  key={id}
                  onPress={() => pick(id)}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <Swatch colors={THEMES[id].swatch} />
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {THEMES[id].label}
                  </Text>
                  {active ? (
                    <MaterialIcons name="check" size={16} color={t.color.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Background, accent and link, in the order the theme declares them. */
function Swatch({ colors }: { colors: readonly [string, string, string] }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.swatch}>
      {colors.map((c) => (
        <View key={c} style={[styles.swatchDot, { backgroundColor: c }]} />
      ))}
    </View>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surface,
  },
  fieldText: { flex: 1, fontFamily: t.font.bodyBold, fontSize: size.body, color: t.color.text },

  backdrop: {
    flex: 1,
    backgroundColor: t.color.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.md,
    padding: space.sm,
    gap: 2,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: t.radius.tile,
  },
  optionActive: { backgroundColor: t.color.sunken },
  optionText: { flex: 1, fontFamily: t.font.body, fontSize: size.body, color: t.color.textMuted },
  optionTextActive: { fontFamily: t.font.bodyBold, color: t.color.accent },

  swatch: { flexDirection: 'row', gap: 3 },
  swatchDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    // Its own hairline, so a near-white background chip stays visible on a
    // near-white surface.
    borderColor: t.color.border,
  },
});

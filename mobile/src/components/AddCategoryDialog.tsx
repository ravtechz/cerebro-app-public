import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { categoryNameTaken } from '../db/categories';
import { space, withAlpha, type Sizes, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import { ICON_CHOICES, MaterialIcons, iconFor } from '../ui/icons';

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => void;
}

export function AddCategoryDialog({ visible, onClose, onCreate }: Props) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(ICON_CHOICES[0]);
  const [error, setError] = useState('');

  const close = () => {
    setName('');
    setIcon(ICON_CHOICES[0]);
    setError('');
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('numele nu poate fi gol');
      return;
    }
    if (await categoryNameTaken(trimmed)) {
      setError('exista deja o categorie cu numele asta');
      return;
    }
    onCreate(trimmed, icon);
    close();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>categorie noua</Text>

          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError('');
            }}
            placeholder="nume categorie"
            placeholderTextColor={t.color.textMuted}
            selectionColor={t.color.link}
            cursorColor={t.color.link}
            keyboardAppearance={t.dark ? 'dark' : 'light'}
            autoFocus
            style={styles.input}
          />

          <ScrollView
            style={styles.iconScroll}
            contentContainerStyle={styles.icons}
            showsVerticalScrollIndicator={false}
          >
            {ICON_CHOICES.map((choice) => {
              const active = choice === icon;
              return (
                <Pressable
                  key={choice}
                  onPress={() => setIcon(choice)}
                  style={[styles.iconBtn, active && styles.iconBtnActive]}
                >
                  <MaterialIcons
                    name={iconFor(choice)}
                    size={22}
                    color={active ? t.color.accent : t.color.text}
                  />
                </Pressable>
              );
            })}
          </ScrollView>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable onPress={close} style={styles.cancel}>
              <Text style={styles.cancelText}>anuleaza</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.confirm}>
              <Text style={styles.confirmText}>adauga</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: t.color.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.md,
    padding: space.lg,
    gap: space.md,
  },
  title: {
    fontFamily: t.font.bodyBold,
    fontSize: size.small,
    letterSpacing: 1.4 * t.type.metaTracking,
    textTransform: t.type.metaTransform,
    color: t.color.accent,
  },
  input: {
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: t.color.text,
    fontFamily: t.font.body,
    fontSize: size.body,
    backgroundColor: t.color.bg,
  },
  // Capped so the dialog keeps its shape as the icon set grows.
  iconScroll: { maxHeight: 232 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: 2 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: t.radius.sm,
    borderWidth: t.border,
    borderColor: t.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { borderColor: t.color.accent, backgroundColor: withAlpha(t.color.accent, 0.1) },
  error: { fontFamily: t.font.body, fontSize: size.tiny, color: t.color.danger },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.md },
  cancel: { paddingHorizontal: space.md, paddingVertical: space.sm },
  cancelText: { fontFamily: t.font.body, fontSize: size.small, color: t.color.textMuted },
  confirm: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: t.radius.chip,
    backgroundColor: t.color.accent,
  },
  confirmText: { fontFamily: t.font.bodyBold, fontSize: size.small, color: t.color.accentInk },
});

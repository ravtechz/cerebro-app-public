import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { space, type Sizes, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import type { Note } from '../types';

interface Props {
  /** The note being edited; null closes the dialog. */
  note: Note | null;
  onClose: () => void;
  onSave: (uuid: string, text: string) => void;
}

export function EditNoteDialog({ note, onClose, onSave }: Props) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [draft, setDraft] = useState('');

  // Seeded per note rather than once: the dialog instance is reused, so opening
  // a second note must not show the first one's text.
  useEffect(() => {
    if (note) setDraft(note.text);
  }, [note]);

  if (!note) return null;

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed !== note.text;

  const save = () => {
    if (!canSave) return;
    onSave(note.uuid, trimmed);
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>editeaza nota</Text>

          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="textul notei"
            placeholderTextColor={t.color.textMuted}
            selectionColor={t.color.link}
            cursorColor={t.color.link}
            keyboardAppearance={t.dark ? 'dark' : 'light'}
            autoFocus
            multiline
            style={styles.input}
          />

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelText}>anuleaza</Text>
            </Pressable>
            <Pressable onPress={save} disabled={!canSave} style={styles.confirm}>
              <Text style={[styles.confirmText, !canSave && styles.confirmTextIdle]}>salveaza</Text>
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
    lineHeight: size.body * 1.6,
    backgroundColor: t.color.bg,
    minHeight: 96,
    maxHeight: 220,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  cancel: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  cancelText: { fontFamily: t.font.body, fontSize: size.small, color: t.color.textMuted },
  confirm: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: t.radius.chip,
    backgroundColor: t.color.accent,
  },
  confirmText: { fontFamily: t.font.bodyBold, fontSize: size.small, color: t.color.accentInk },
  confirmTextIdle: { opacity: 0.45 },
});

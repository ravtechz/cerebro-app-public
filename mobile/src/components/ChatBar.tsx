import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { layout, space, type Sizes, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import type { WorkerStatus } from '../sync/worker';
import { MaterialIcons } from '../ui/icons';

const WORKER_LABEL: Record<WorkerStatus, string> = {
  idle: 'worker synced',
  busy: 'worker busy',
  error: 'worker retry',
};

interface Props {
  workerStatus: WorkerStatus;
  onSend: (text: string) => void;
}

export function ChatBar({ workerStatus, onSend }: Props) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onSend(text);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder="scrie o nota…"
          placeholderTextColor={t.color.textMuted}
          selectionColor={t.color.link}
          cursorColor={t.color.link}
          keyboardAppearance={t.dark ? 'dark' : 'light'}
          multiline
          style={styles.input}
          returnKeyType="send"
          blurOnSubmit
        />
        <Pressable
          onPress={send}
          disabled={!canSend}
          style={[styles.send, canSend ? styles.sendReady : styles.sendIdle]}
        >
          <MaterialIcons name="arrow-upward" size={20} color={t.color.accentInk} />
        </Pressable>
      </View>
      <Text style={styles.footer}>{WORKER_LABEL[workerStatus]} · local-first</Text>
    </View>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm, gap: 6 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.bar,
    paddingLeft: space.lg,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    color: t.color.text,
    fontFamily: t.font.body,
    fontSize: size.body,
    maxHeight: 120,
    paddingVertical: space.sm,
  },
  send: {
    width: layout.sendButton,
    height: layout.sendButton,
    borderRadius: layout.sendButton / 2,
    backgroundColor: t.color.link,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendReady: t.glow.button ?? {},
  sendIdle: { opacity: 0.45 },
  footer: {
    textAlign: 'center',
    fontFamily: t.font.body,
    fontSize: size.micro,
    letterSpacing: 0.8 * t.type.metaTracking,
    color: t.color.textMuted,
    opacity: 0.7,
  },
});

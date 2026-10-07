import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiClient, testConnection } from '../api';
import { ThemeDropdown } from '../components/ThemeDropdown';
import { useStore } from '../store/useStore';
import {
  glyphPrefix,
  makeSize,
  space,
  statusMeta,
  withAlpha,
  TEXT_SIZES,
  type Sizes,
  type TextSize,
  type Theme,
} from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import { MaterialIcons } from '../ui/icons';

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done'; ok: boolean; message: string };

const TEXT_SIZE_LABEL: Record<TextSize, string> = { small: 'S', medium: 'M', large: 'L' };

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useStore();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  /**
   * "Test connection" is what unlocks the switch from the mock to the real
   * backend — a URL alone is never enough, so this also spends an empty /sync
   * to prove the key is accepted. Its result is persisted, not just displayed:
   * `connectionOk` is the flag `getApiClient` reads on every sync cycle.
   */
  const runTest = async () => {
    setTest({ kind: 'testing' });
    const next = { ...settings, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() };
    const result = await testConnection(next);
    await updateSettings({ ...next, connectionOk: result.ok });
    setTest({
      kind: 'done',
      ok: result.ok,
      message: result.ok ? 'conectat — sincronizarea foloseste backend-ul' : result.message,
    });
  };

  /**
   * Editing the URL or the key invalidates the last test: those credentials
   * were never proven, and `connectionOk` must not vouch for them. Dropping it
   * falls back to the mock rather than to a client that cannot sync.
   */
  const save = async () => {
    const changed = baseUrl.trim() !== settings.baseUrl || apiKey.trim() !== settings.apiKey;
    await updateSettings({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      ...(changed ? { connectionOk: false } : {}),
    });
    onClose();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <MaterialIcons name="close" size={22} color={t.color.textMuted} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>api base url</Text>
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="http://100.x.y.z:8000"
          placeholderTextColor={t.color.textMuted}
          selectionColor={t.color.link}
          cursorColor={t.color.link}
          keyboardAppearance={t.dark ? 'dark' : 'light'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />

        <Text style={styles.label}>api key</Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="cheia ta din .env-ul serverului"
          placeholderTextColor={t.color.textMuted}
          selectionColor={t.color.link}
          cursorColor={t.color.link}
          keyboardAppearance={t.dark ? 'dark' : 'light'}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />

        <Pressable onPress={runTest} style={styles.testBtn} disabled={test.kind === 'testing'}>
          <Text style={styles.testText}>
            {test.kind === 'testing' ? 'se testeaza…' : 'Test connection'}
          </Text>
        </Pressable>

        {test.kind === 'done' ? (
          <Text style={[styles.result, { color: test.ok ? t.color.link : t.color.danger }]}>
            {test.message}
          </Text>
        ) : null}

        <View style={styles.divider} />

        {/* Both display preferences are applied on tap, not on "salveaza": they
            are not credentials, and seeing them land is the whole point. */}
        <Text style={styles.label}>tema</Text>
        <ThemeDropdown
          value={settings.themeId}
          onChange={(themeId) => void updateSettings({ themeId })}
        />

        {/* A stand-in rather than a real NoteCard: this one needs no note, no
            category lookup and no callbacks, and it must not follow the card's
            behaviour as that changes. It only has to be looked at — by both
            controls, which is why it sits between them. */}
        <View style={styles.preview}>
          <View style={styles.previewMeta}>
            <View style={styles.previewChip}>
              <Text style={styles.previewChipText} numberOfLines={1}>
                idei youtube
              </Text>
            </View>
            <Text style={styles.previewStatus}>
              {glyphPrefix(t, statusMeta.pending.glyph)}
              {statusMeta.pending.label}
            </Text>
            <Text style={styles.previewTime}>acum 2h</Text>
          </View>
          <Text style={styles.previewText}>Sa nu uit sa cumpar bilete la concertul de vineri</Text>
        </View>

        <Text style={styles.label}>text size</Text>
        <View style={styles.sizeRow}>
          {TEXT_SIZES.map((option) => {
            const active = settings.textSize === option;
            return (
              <Pressable
                key={option}
                onPress={() => void updateSettings({ textSize: option })}
                style={[styles.sizeBtn, active && styles.sizeBtnActive]}
              >
                <Text style={[styles.sizeText, active && styles.sizeTextActive]}>
                  {TEXT_SIZE_LABEL[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        <Text style={styles.note}>
          {getApiClient(settings).kind === 'http'
            ? 'Sincronizarea trimite notele catre backend. Ai nevoie de Tailscale pornit.'
            : 'Sincronizarea ruleaza local, pe clientul mock. Pune base url + api key si apasa Test connection ca sa treci pe backend.'}
        </Text>

      </ScrollView>

      {/* Pinned rather than the last thing in the ScrollView. The screen got tall
          enough that the button sat below the fold and, at the end of the scroll,
          half under the home indicator. It also saves only the two fields at the
          top — theme and text size apply on tap — so burying it under everything
          they do not affect was misleading anyway. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <Pressable onPress={save} style={styles.saveBtn}>
          <Text style={styles.saveText}>salveaza</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderBottomColor: t.color.border,
    borderBottomWidth: t.border,
  },
  title: {
    fontFamily: t.font.display,
    fontSize: size.displaySmall,
    letterSpacing: 1 * t.type.displayTracking,
    textTransform: t.type.displayTransform,
    color: t.color.text,
  },
  content: { padding: space.lg, gap: space.sm },
  label: {
    fontFamily: t.font.body,
    fontSize: size.micro,
    letterSpacing: 1.6 * t.type.metaTracking,
    textTransform: t.type.metaTransform,
    color: t.color.subtle,
    marginTop: space.md,
  },
  input: {
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: t.color.surface,
    color: t.color.text,
    fontFamily: t.font.body,
    fontSize: size.body,
  },
  testBtn: {
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: t.radius.chip,
    borderWidth: t.border,
    borderColor: t.color.link,
  },
  testText: { fontFamily: t.font.body, fontSize: size.small, color: t.color.link },
  result: { fontFamily: t.font.body, fontSize: size.tiny, marginTop: space.sm },
  divider: { height: 1, backgroundColor: t.color.border, marginVertical: space.lg },

  preview: {
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.md,
    padding: space.md,
    marginTop: space.md,
    gap: 6,
    ...(t.statusBand
      ? { borderLeftWidth: 4, borderLeftColor: t.color.status.pending }
      : {}),
  },
  previewMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  previewChip: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: t.radius.chip,
    backgroundColor: withAlpha(t.color.accent, 0.12),
    flexShrink: 1,
  },
  previewChipText: {
    fontFamily: t.font.bodyBold,
    fontSize: size.micro,
    letterSpacing: 1 * t.type.chipTracking,
    textTransform: t.type.chipTransform,
    color: t.color.accent,
  },
  previewStatus: {
    fontFamily: t.font.body,
    fontSize: size.micro,
    letterSpacing: 0.6 * t.type.metaTracking,
    color: t.color.status.pending,
  },
  previewTime: {
    marginLeft: 'auto',
    fontFamily: t.font.body,
    fontSize: size.tiny,
    color: t.color.textMuted,
  },
  previewText: {
    fontFamily: t.font.body,
    fontSize: size.body,
    lineHeight: size.body * 1.6,
    color: t.color.textDim,
  },

  sizeRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  sizeBtn: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: t.radius.chip,
    borderWidth: t.border,
    borderColor: t.color.border,
    alignItems: 'center',
  },
  sizeBtnActive: { borderColor: t.color.accent, backgroundColor: withAlpha(t.color.accent, 0.12) },
  sizeText: {
    fontFamily: t.font.bodyBold,
    // The picker pins to one scale instead of following the setting: a control
    // that resizes under the finger pressing it reads as a glitch, and the three
    // buttons must stay equal to each other to look like one control. It still
    // follows the theme, which is what makes it look native to each one.
    fontSize: makeSize('medium', t).body,
    letterSpacing: 1.4 * t.type.metaTracking,
    color: t.color.textMuted,
  },
  sizeTextActive: { color: t.color.accent },
  note: {
    fontFamily: t.font.body,
    fontSize: size.tiny,
    lineHeight: size.tiny * 1.6,
    color: t.color.textMuted,
    marginTop: space.lg,
  },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopColor: t.color.border,
    borderTopWidth: t.border,
    backgroundColor: t.color.bg,
  },
  saveBtn: {
    paddingVertical: space.md,
    borderRadius: t.radius.chip,
    backgroundColor: t.color.accent,
    alignItems: 'center',
  },
  saveText: { fontFamily: t.font.bodyBold, fontSize: size.small, color: t.color.accentInk },
});

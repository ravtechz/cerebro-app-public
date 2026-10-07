import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  glyphPrefix,
  layout,
  space,
  statusMeta,
  trashCountdown,
  withAlpha,
  type Sizes,
  type Theme,
} from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import type { Category, Note } from '../types';
import { MaterialIcons } from '../ui/icons';
import { PulseDot } from '../ui/PulseDot';
import { parseNoteText } from '../utils/link';
import { ago, stamp, trashHint } from '../utils/time';
import { LinkPreview } from './LinkPreview';

interface Props {
  note: Note;
  category: Category | undefined;
  inTrash: boolean;
  /** Seconds until this ticked note moves to the trash; undefined when idle. */
  trashInSeconds?: number;
  onToggleDone: () => void;
  onRestore: () => void;
  onRetry: () => void;
  onEdit: () => void;
}

export function NoteCard({
  note,
  category,
  inTrash,
  trashInSeconds,
  onToggleDone,
  onRestore,
  onRetry,
  onEdit,
}: Props) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const meta = statusMeta[note.status];
  const statusColor = t.color.status[note.status];
  const parsed = useMemo(() => parseNoteText(note.text), [note.text]);

  const busy = note.status === 'pending' || note.status === 'categorizing';
  const countingDown = trashInSeconds !== undefined && !inTrash;
  // Category and sync state are two different facts, so they get two different
  // slots — the status never disappears once a note lands in a category.
  const chipLabel = category?.name ?? 'necategorizat';
  const chipColor = category ? t.color.accent : t.color.subtle;

  return (
    // Trashed notes are read-only: restore first, then edit. The checkbox, the
    // link preview and "retry sync" are nested Pressables, and the innermost one
    // wins the touch, so none of them opens the editor by accident.
    <Pressable
      onPress={inTrash ? undefined : onEdit}
      disabled={inTrash}
      style={[
        styles.card,
        note.status === 'categorizing' && styles.cardBusy,
        note.status === 'error' && styles.cardError,
        // Blush and Pastel repeat the status as a band down the left edge, which
        // is the only structural difference between the themes.
        t.statusBand && { borderLeftWidth: layout.statusBand, borderLeftColor: statusColor },
      ]}
    >
        <View style={styles.row}>
          {/* No checkbox in the trash: ticking is what put the note here. */}
          {inTrash ? null : (
            <Pressable
              onPress={onToggleDone}
              hitSlop={10}
              style={[styles.checkbox, note.done && styles.checkboxDone]}
            >
              {note.done ? (
                <MaterialIcons name="check" size={13} color={t.color.accentInk} />
              ) : null}
            </Pressable>
          )}

          {/* The dimming lives here, not on the card: a 55% restore button on a
              55% card is why the action went unnoticed. */}
          <View style={[styles.body, inTrash && styles.contentTrashed]}>
            <View style={styles.metaRow}>
              <View style={[styles.chip, { backgroundColor: withAlpha(chipColor, 0.12) }]}>
                <Text style={[styles.chipText, { color: chipColor }]} numberOfLines={1}>
                  {chipLabel}
                </Text>
              </View>

              {/* The countdown takes over the status slot: while a note is on
                  its way out, when it leaves matters more than whether it
                  synced. The sync status comes back if you untick it. */}
              <View style={styles.status}>
                {countingDown ? (
                  <>
                    <PulseDot color={t.color.warn} pulse />
                    <Text
                      style={[styles.statusText, { color: t.color.warn }]}
                      numberOfLines={1}
                    >
                      {glyphPrefix(t, trashCountdown.glyph)}
                      {trashCountdown.label} {trashInSeconds}s
                    </Text>
                  </>
                ) : (
                  <>
                    <PulseDot color={statusColor} pulse={busy} />
                    <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
                      {glyphPrefix(t, meta.glyph)}
                      {meta.label}
                    </Text>
                  </>
                )}
              </View>

              <Text style={styles.time}>{ago(note.updatedAt)}</Text>
            </View>

            {parsed.body ? (
              <Text style={[styles.text, note.done && styles.textDone]}>{parsed.body}</Text>
            ) : null}

            {parsed.url ? (
              <LinkPreview
                url={parsed.url}
                host={parsed.host}
                path={parsed.path}
                dimmed={note.done}
              />
            ) : null}

            {/* Created, not updated: updated_at moves on every tick, trash and
                restore, so as "the note's date" it would lie. Its own line
                because the meta row above cannot fit 18 more characters without
                truncating the category name. */}
            <Text style={styles.stamp}>{stamp(note.createdAt)}</Text>

            {inTrash && note.deletedAt ? (
              <Text style={styles.hint}>{trashHint(note.deletedAt)}</Text>
            ) : null}

            {note.status === 'error' && !inTrash ? (
              <Pressable onPress={onRetry} hitSlop={8} style={styles.retry}>
                <MaterialIcons name="refresh" size={12} color={t.color.danger} />
                <Text style={styles.retryText}>retry sync</Text>
              </Pressable>
            ) : null}
          </View>
      </View>

      {/* Outside the dimmed body on purpose, so it reads at full strength, and
          labelled rather than icon-only: this is the one way back out of the
          trash, and it has to be findable without guessing. */}
      {inTrash ? (
        <Pressable onPress={onRestore} hitSlop={10} style={styles.restore}>
          <MaterialIcons name="restore-from-trash" size={14} color={t.color.link} />
          <Text style={styles.restoreText}>restore</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  card: {
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: t.border,
    borderRadius: t.radius.md,
    padding: space.md,
  },
  /** Only the busy card is lifted; the rest sit flat, per every theme's design. */
  cardBusy: {
    borderColor: withAlpha(t.color.status.categorizing, 0.55),
    ...(t.glow.card ?? {}),
  },
  cardError: { borderColor: withAlpha(t.color.status.error, 0.4) },
  /** Dims the note itself; the restore button sits outside this and stays lit. */
  contentTrashed: { opacity: 0.55 },
  row: { flexDirection: 'row', gap: space.md },
  checkbox: {
    width: layout.checkbox,
    height: layout.checkbox,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDone: { backgroundColor: t.color.accent, borderColor: t.color.accent },
  restore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: space.sm,
  },
  restoreText: {
    fontFamily: t.font.bodyBold,
    fontSize: size.tiny,
    letterSpacing: 0.8 * t.type.metaTracking,
    color: t.color.link,
  },
  body: { flex: 1, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: t.radius.chip,
    flexShrink: 1,
  },
  chipText: {
    fontFamily: t.font.bodyBold,
    fontSize: size.micro,
    letterSpacing: 1 * t.type.chipTracking,
    textTransform: t.type.chipTransform,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  statusText: {
    fontFamily: t.font.body,
    fontSize: size.micro,
    letterSpacing: 0.6 * t.type.metaTracking,
  },
  time: {
    marginLeft: 'auto',
    fontFamily: t.font.body,
    fontSize: size.tiny,
    color: t.color.textMuted,
  },
  text: {
    fontFamily: t.font.body,
    fontSize: size.body,
    lineHeight: size.body * 1.6,
    color: t.color.textDim,
  },
  textDone: { textDecorationLine: 'line-through', color: t.color.textFaint },
  stamp: { fontFamily: t.font.body, fontSize: size.tiny, color: t.color.textMuted },
  hint: { fontFamily: t.font.body, fontSize: size.tiny, color: t.color.textMuted },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  retryText: { fontFamily: t.font.body, fontSize: size.tiny, color: t.color.danger },
});

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddCategoryDialog } from '../components/AddCategoryDialog';
import { ChatBar } from '../components/ChatBar';
import { DragGhost } from '../components/DragGhost';
import { DraggableNote } from '../components/DraggableNote';
import { EditNoteDialog } from '../components/EditNoteDialog';
import { Header, type HeaderAction } from '../components/Header';
import { NoteCard } from '../components/NoteCard';
import { Sidebar, type SidebarHandle } from '../components/Sidebar';
import { unlessDragged } from '../drag/tapGuard';
import { useNoteDrag } from '../drag/useNoteDrag';
import { useStore } from '../store/useStore';
import { space, type Sizes, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/useStyles';
import { INBOX_ID, type Note } from '../types';

/** Ceil, so a fresh 10s countdown reads "10s" rather than starting at 9. */
const secondsUntilTrash = (deadline: number | undefined): number | undefined =>
  deadline === undefined ? undefined : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

export function HomeScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);

  const {
    notes,
    categories,
    view,
    sidebarOpen,
    workerStatus,
    doneDeadlines,
    setView,
    setSidebarOpen,
    addNote,
    editNote,
    moveNote,
    toggleDone,
    restore,
    retryNote,
    clearDone,
    emptyTrash,
    addCategory,
    deleteCategory,
    syncNow,
  } = useStore();

  const inTrash = view.kind === 'trash';

  const sidebar = useRef<SidebarHandle>(null);
  /**
   * The sidebar opens itself for the drag — the drop targets are in it, and the
   * rail is collapsed to icons most of the time — and goes back to however the
   * user had left it once the note lands.
   */
  const sidebarWasOpen = useRef(false);
  const drag = useNoteDrag({
    measureTargets: useCallback(
      () => sidebar.current?.measureTargets() ?? Promise.resolve([]),
      []
    ),
    onDrop: useCallback(
      (uuid: string, categoryId: number) => void moveNote(uuid, categoryId),
      [moveNote]
    ),
    onModeChange: useCallback(
      (dragging: boolean) => {
        if (dragging) {
          sidebarWasOpen.current = useStore.getState().sidebarOpen;
          setSidebarOpen(true);
        } else {
          setSidebarOpen(sidebarWasOpen.current);
        }
      },
      [setSidebarOpen]
    ),
  });
  const dragging = drag.note !== null;

  const visible = useMemo<Note[]>(() => {
    if (inTrash) return notes.filter((n) => n.deletedAt !== null);
    const id = view.kind === 'category' ? view.categoryId : INBOX_ID;
    return notes.filter(
      (n) => n.deletedAt === null && (n.categoryId === id || (id === INBOX_ID && n.categoryId === null))
    );
  }, [notes, view, inTrash]);

  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const n of notes) {
      if (n.deletedAt !== null || n.done) continue;
      const id = n.categoryId ?? INBOX_ID;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const editingNote = useMemo(
    () => notes.find((n) => n.uuid === editingUuid) ?? null,
    [notes, editingUuid]
  );

  /** Notes the categorizer filed since the user last opened that category. */
  const newCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const n of notes) {
      if (!n.isNew || n.deletedAt !== null || n.categoryId === null) continue;
      map.set(n.categoryId, (map.get(n.categoryId) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const trashCount = useMemo(() => notes.filter((n) => n.deletedAt !== null).length, [notes]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const activeCategory = view.kind === 'category' ? categoryById.get(view.categoryId) : undefined;
  const title = inTrash ? 'Trash' : (activeCategory?.name ?? 'Inbox');

  const emptyMessage = inTrash
    ? 'trash-ul e gol'
    : title === 'Inbox'
      ? 'inbox gol · totul e sortat'
      : `nimic in ${title} inca`;

  const confirmEmptyTrash = () =>
    Alert.alert('Empty trash', 'Stergi definitiv toate notele din trash?', [
      { text: 'anuleaza', style: 'cancel' },
      { text: 'sterge', style: 'destructive', onPress: () => void emptyTrash() },
    ]);

  /**
   * Deleting a category is the one destructive action here that cannot be
   * undone by tapping again, so the dialog says exactly how many notes move and
   * that they are recoverable — the category itself is not.
   */
  const confirmDeleteCategory = () => {
    if (!activeCategory) return;
    // `visible` is already this category's live notes — trashed ones only show
    // in the Trash view, and they are not moving anywhere.
    const live = visible.length;
    const noteLine =
      live === 0
        ? 'Nu are nicio nota.'
        : live === 1
          ? 'Nota ei merge in trash si poate fi recuperata 30 de zile.'
          : `Cele ${live} note ale ei merg in trash si pot fi recuperate 30 de zile.`;
    Alert.alert(
      `Sterge ${activeCategory.name}`,
      `${noteLine} Categoria dispare definitiv, de pe telefon si de pe server.`,
      [
        { text: 'anuleaza', style: 'cancel' },
        {
          text: 'sterge',
          style: 'destructive',
          onPress: () => void deleteCategory(activeCategory.id),
        },
      ]
    );
  };

  const headerActions: HeaderAction[] = [];
  if (inTrash) {
    if (trashCount > 0) {
      headerActions.push({
        icon: 'delete-sweep',
        label: 'empty trash',
        onPress: confirmEmptyTrash,
      });
    }
  } else {
    if (visible.some((n) => n.done)) {
      headerActions.push({
        icon: 'playlist-add-check',
        label: 'clear done',
        onPress: () => void clearDone(view.kind === 'category' ? view.categoryId : INBOX_ID),
      });
    }
    // Inbox is structural and has no delete: it is where uncategorised notes are
    // shown, and every other category's notes fall back to it.
    if (activeCategory && activeCategory.id !== INBOX_ID) {
      headerActions.push({
        icon: 'delete-outline',
        label: 'sterge categoria',
        onPress: confirmDeleteCategory,
      });
    }
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await syncNow();
    setRefreshing(false);
  };

  return (
    // The safe-area inset sits on `body`, not here: Yoga positions absolute
    // children inside the padding box, and the drag ghost is placed in window
    // coordinates straight from `measureInWindow`.
    <View style={styles.root}>
      <View style={[styles.body, { paddingTop: insets.top }]}>
        <Sidebar
          ref={sidebar}
          open={sidebarOpen}
          categories={categories}
          counts={counts}
          newCounts={newCounts}
          trashCount={trashCount}
          view={view}
          dragging={dragging}
          hoverId={drag.hoverId}
          onPick={setView}
          onAddCategory={() => setAddOpen(true)}
          onOpenSettings={onOpenSettings}
        />

        <KeyboardAvoidingView
          style={styles.main}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top}
        >
          <Header
            title={title}
            count={visible.length}
            actions={headerActions}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />

          <FlatList
            data={visible}
            keyExtractor={(n) => n.uuid}
            contentContainerStyle={styles.list}
            keyboardDismissMode="on-drag"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={t.color.accent}
                colors={[t.color.accent]}
              />
            }
            ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
            renderItem={({ item }) => (
              <DraggableNote drag={drag} note={item} enabled={!inTrash}>
                <NoteCard
                  note={item}
                  category={
                    item.categoryId === null ? undefined : categoryById.get(item.categoryId)
                  }
                  inTrash={inTrash}
                  trashInSeconds={secondsUntilTrash(doneDeadlines[item.uuid])}
                  // A hold that lifts the card and is then abandoned in place
                  // still ends as a tap on whichever Pressable was under the
                  // finger — see `unlessDragged`. Ticking a note done because
                  // you thought better of moving it is the worst of these.
                  onToggleDone={unlessDragged(() => void toggleDone(item.uuid))}
                  onRestore={() => void restore(item.uuid)}
                  onRetry={unlessDragged(() => void retryNote(item.uuid))}
                  onEdit={unlessDragged(() => setEditingUuid(item.uuid))}
                />
              </DraggableNote>
            )}
          />

          {inTrash ? null : (
            <ChatBar workerStatus={workerStatus} onSend={(text) => void addNote(text)} />
          )}
          <View style={{ height: Math.max(insets.bottom, space.sm) }} />

          {/* No scrim during a drag: the sidebar opened itself for the drop, and
              dimming the list would hide the note you are still holding. */}
          {sidebarOpen && !dragging ? (
            <Pressable style={styles.scrim} onPress={() => setSidebarOpen(false)} />
          ) : null}
        </KeyboardAvoidingView>
      </View>

      <AddCategoryDialog
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={(name, icon) => void addCategory(name, icon)}
      />

      {/* Resolved from the store by uuid rather than captured on tap: if a sync
          lands while the dialog is open, it edits the note that actually exists.
          A note purged underneath it closes the dialog instead of editing a ghost. */}
      <EditNoteDialog
        note={editingNote}
        onClose={() => setEditingUuid(null)}
        onSave={(uuid, text) => void editNote(uuid, text)}
      />

      {/* Last child of the root, so the card being dragged passes over the
          sidebar instead of under it. */}
      <DragGhost
        drag={drag}
        category={
          drag.note === null || drag.note.categoryId === null
            ? undefined
            : categoryById.get(drag.note.categoryId)
        }
      />
    </View>
  );
}

const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.bg },
  body: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  list: { padding: space.md, gap: 10, flexGrow: 1 },
  empty: {
    textAlign: 'center',
    marginTop: 60,
    fontFamily: t.font.body,
    fontSize: size.small,
    color: t.color.subtle,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.scrim,
  },
});

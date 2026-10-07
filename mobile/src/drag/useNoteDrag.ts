import { useCallback, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

import { layout } from '../theme/tokens';
import type { Note } from '../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sidebar category row a note can be dropped on, in window coordinates. */
export interface DropTarget {
  categoryId: number;
  top: number;
  bottom: number;
}

interface Options {
  /** Measures the sidebar's category rows. Called once, when a drag begins. */
  measureTargets: () => Promise<DropTarget[]>;
  onDrop: (uuid: string, categoryId: number) => void;
  /** Opens the sidebar for the duration of the drag and puts it back after. */
  onModeChange: (dragging: boolean) => void;
}

export interface NoteDrag {
  /** The note in the air, or null when nothing is being dragged. */
  note: Note | null;
  /** Where its card sat in the list when the hold fired. */
  rect: Rect | null;
  /** Category row currently under the finger. */
  hoverId: number | null;
  pan: Animated.ValueXY;
  lift: Animated.Value;
  fade: Animated.Value;

  begin: (note: Note, rect: Rect, finger: { x: number; y: number }) => void;
  move: (pageX: number, pageY: number) => void;
  end: (cancelled: boolean) => void;
}

/**
 * The drag half of drag & drop, kept entirely outside the store.
 *
 * Every mutation in this app goes to SQLite and reloads from it, which is right
 * for state that has to survive but hopeless sixty times a second — so the
 * finger's position lives in `Animated` values that never re-render anything,
 * and only the hovered row (a handful of changes per drag) is React state. The
 * store hears about this exactly once, on a successful drop.
 *
 * Nothing here is native-driven. The pan value is written from JS on every touch
 * move and read back in the same callback to decide what is under the finger,
 * and a value that is both JS-written and native-animated is the standard way to
 * earn "Attempting to run JS driven animation on animated node that has been
 * moved to native". One overlay view is well within what the JS driver handles.
 */
export function useNoteDrag(options: Options): NoteDrag {
  // Read through a ref so the callbacks below can stay stable while still
  // seeing the current store actions.
  const opts = useRef(options);
  opts.current = options;

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lift = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  const [note, setNote] = useState<Note | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);

  const activeUuid = useRef<string | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const targets = useRef<DropTarget[]>([]);
  const hover = useRef<number | null>(null);

  const clear = useCallback(() => {
    // A new hold may have started while the previous card was still animating
    // home; that drag already owns the state, so this one must not wipe it.
    if (activeUuid.current !== null) return;
    setNote(null);
    setRect(null);
    setHoverId(null);
    targets.current = [];
    hover.current = null;
    fade.setValue(1);
  }, [fade]);

  const begin = useCallback(
    (n: Note, r: Rect, finger: { x: number; y: number }) => {
      pan.stopAnimation();
      lift.stopAnimation();
      fade.stopAnimation();

      origin.current = finger;
      activeUuid.current = n.uuid;
      targets.current = [];
      hover.current = null;

      pan.setValue({ x: 0, y: 0 });
      lift.setValue(0);
      fade.setValue(1);
      setNote(n);
      setRect(r);
      setHoverId(null);
      opts.current.onModeChange(true);

      Animated.timing(lift, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();

      // The sidebar is opening as this resolves. Only the rows' vertical bands
      // are needed and those do not move — the animation is on width alone — so
      // there is nothing to wait for.
      void opts.current.measureTargets().then((measured) => {
        if (activeUuid.current === n.uuid) targets.current = measured;
      });
    },
    [pan, lift, fade]
  );

  const move = useCallback(
    (pageX: number, pageY: number) => {
      pan.setValue({ x: pageX - origin.current.x, y: pageY - origin.current.y });

      // The x test uses the open width rather than each row's measured one: the
      // rows were measured while the sidebar was still collapsed, so their width
      // is the 58px rail and would make the drop zone a sliver.
      const over =
        pageX <= layout.sidebarOpen
          ? targets.current.find((t) => pageY >= t.top && pageY < t.bottom)
          : undefined;
      const next = over?.categoryId ?? null;
      if (next !== hover.current) {
        hover.current = next;
        setHoverId(next);
      }
    },
    [pan]
  );

  const end = useCallback(
    (cancelled: boolean) => {
      const uuid = activeUuid.current;
      if (uuid === null) return;
      const target = cancelled ? null : hover.current;

      activeUuid.current = null;
      opts.current.onModeChange(false);

      if (target !== null) {
        opts.current.onDrop(uuid, target);
        // Dissolve rather than fly home: the note has just left this list, and
        // animating it back to a row that no longer holds it reads as a failure.
        Animated.timing(fade, {
          toValue: 0,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start(clear);
        return;
      }

      Animated.parallel([
        Animated.timing(pan, {
          toValue: { x: 0, y: 0 },
          duration: layout.dragReturnMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(lift, {
          toValue: 0,
          duration: layout.dragReturnMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]).start(clear);
    },
    [pan, lift, fade, clear]
  );

  return { note, rect, hoverId, pan, lift, fade, begin, move, end };
}

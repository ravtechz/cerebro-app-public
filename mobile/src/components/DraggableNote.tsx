import { useEffect, useRef, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { allowTap, blockTap } from '../drag/tapGuard';
import type { NoteDrag } from '../drag/useNoteDrag';
import { layout } from '../theme/tokens';
import type { Note } from '../types';

interface Props {
  drag: NoteDrag;
  note: Note;
  /** Off in the trash, where a note has no category to be moved between. */
  enabled: boolean;
  children: ReactNode;
}

/**
 * Turns a note card into something you can pick up.
 *
 * The hard part is not the movement, it is not stealing anything: the card is
 * still a button that opens the editor, and the list under it still has to
 * scroll. So this claims nothing on touch down. A hold that survives
 * `dragHoldMs` without drifting more than `dragSlop` arms the gesture, and only
 * then does `onMoveShouldSetPanResponder` start answering yes — at which point
 * the responder negotiation hands the touch over from the FlatList on the first
 * movement.
 *
 * `scrollEnabled` is deliberately left alone. Flipping it mid-touch is the
 * obvious way to keep the list still, and on iOS it cancels the touch that is
 * already in flight — the drag would die the instant it started. Winning the
 * responder is enough: the list cannot scroll on a touch it no longer owns.
 *
 * The `onTouch*` props are not part of the responder system and fire whether or
 * not this view owns the gesture, which is what makes the hold timer possible
 * without claiming anything first.
 */
export function DraggableNote({ drag, note, enabled, children }: Props) {
  const host = useRef<View>(null);

  // The PanResponder is built once and would otherwise close over the first
  // render's props forever.
  const latest = useRef({ drag, note, enabled });
  latest.current = { drag, note, enabled };

  const armed = useRef(false);
  const claimed = useRef(false);
  const touching = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const down = useRef({ x: 0, y: 0 });
  const finger = useRef({ x: 0, y: 0 });

  const cancelHold = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => cancelHold, []);

  const hold = () => {
    timer.current = null;
    const node = host.current;
    if (node === null) return;
    const { drag: d, note: n } = latest.current;

    node.measureInWindow((x, y, width, height) => {
      // measureInWindow answers a frame later, by which time the finger may
      // already be gone — lifting the card then would leave it stranded, since
      // no release handler is coming for a touch that has ended.
      if (!touching.current || width === 0 || height === 0) return;
      armed.current = true;
      blockTap();
      d.begin(n, { x, y, width, height }, finger.current);
    });
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    down.current = { x: pageX, y: pageY };
    finger.current = { x: pageX, y: pageY };
    touching.current = true;
    armed.current = false;
    claimed.current = false;
    allowTap();
    cancelHold();
    if (!latest.current.enabled) return;
    timer.current = setTimeout(hold, layout.dragHoldMs);
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    finger.current = { x: pageX, y: pageY };
    if (armed.current || timer.current === null) return;
    // Moved before the card lifted: this is a scroll, not a hold.
    const travel = Math.hypot(pageX - down.current.x, pageY - down.current.y);
    if (travel > layout.dragSlop) cancelHold();
  };

  const onTouchEnd = () => {
    touching.current = false;
    cancelHold();
    // Lifted, then released without ever moving. Nothing claimed the responder,
    // so no release handler will run and the card has to be put down here.
    if (armed.current && !claimed.current) {
      armed.current = false;
      latest.current.drag.end(true);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => armed.current,
      onPanResponderGrant: () => {
        claimed.current = true;
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const { pageX, pageY } = e.nativeEvent;
        latest.current.drag.move(pageX, pageY);
      },
      // Once the card is in the air nothing else may take the gesture back.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        armed.current = false;
        latest.current.drag.end(false);
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        latest.current.drag.end(true);
      },
    })
  ).current;

  const lifted = drag.note?.uuid === note.uuid;

  return (
    <View
      ref={host}
      // Without this the wrapper is flattened away at layout time and there is
      // no native view left to measure.
      collapsable={false}
      style={lifted ? styles.lifted : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      {...responder.panHandlers}
    >
      {children}
    </View>
  );
}

/**
 * The gap the card left behind. Not `display: none` — the row keeps its height
 * so the list does not reflow under the finger, and the outline stays as a
 * reminder of where the note will land if the drag is abandoned.
 */
const styles = StyleSheet.create({
  lifted: { opacity: 0.25 },
});

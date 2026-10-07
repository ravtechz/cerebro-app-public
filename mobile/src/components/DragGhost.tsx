import { Animated, StyleSheet } from 'react-native';

import type { NoteDrag } from '../drag/useNoteDrag';
import { layout, type Sizes, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/useStyles';
import type { Category } from '../types';
import { NoteCard } from './NoteCard';

interface Props {
  drag: NoteDrag;
  category: Category | undefined;
}

const noop = () => {};

/**
 * The card while it is in the air.
 *
 * A real `NoteCard`, not a stand-in: the note under the finger has to be the one
 * you recognise from the list, chip and status included. It renders at the
 * screen root rather than inside the FlatList so nothing clips it once it
 * crosses into the sidebar, which is exactly where it is going.
 *
 * The countdown is not passed through. A drop cancels the done → trash timer
 * anyway (`moveNote`), so a card counting down to disappear while being filed
 * somewhere would be announcing something that is not going to happen.
 */
export function DragGhost({ drag, category }: Props) {
  const styles = useStyles(makeStyles);
  const { note, rect } = drag;
  if (note === null || rect === null) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ghost,
        {
          top: rect.y,
          left: rect.x,
          width: rect.width,
          opacity: drag.fade,
          transform: [
            { translateX: drag.pan.x },
            { translateY: drag.pan.y },
            {
              scale: drag.lift.interpolate({
                inputRange: [0, 1],
                outputRange: [1, layout.dragScale],
              }),
            },
            {
              rotate: drag.lift.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', layout.dragTilt],
              }),
            },
          ],
        },
      ]}
    >
      <NoteCard
        note={note}
        category={category}
        inTrash={false}
        onToggleDone={noop}
        onRestore={noop}
        onRetry={noop}
        onEdit={noop}
      />
    </Animated.View>
  );
}

const makeStyles = (t: Theme, _size: Sizes) => StyleSheet.create({
  // The card inside paints its own background; this one carries the same shape
  // only so iOS has something opaque to hang the shadow on.
  ghost: {
    position: 'absolute',
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
    ...t.glow.drag,
  },
});

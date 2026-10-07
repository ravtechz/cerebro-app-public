/**
 * Keeps an abandoned drag from landing as a tap.
 *
 * A hold arms the drag before the finger has moved anywhere, and the card is
 * built out of Pressables — the card itself opens the editor, the checkbox ticks
 * the note, the link preview opens a browser. Every one of them is still sitting
 * there waiting for the touch to end. So a user who holds a note, sees it lift,
 * changes their mind and lets go would tick it done or leave the app.
 *
 * Dragging somewhere and releasing is not affected: winning the responder
 * terminates the Pressable underneath, which cancels its press for us. Only the
 * lift-and-abandon case needs this.
 *
 * Module state rather than a value on the drag controller because a Pressable
 * four levels down inside a card has no business taking a drag object as a prop
 * to answer a yes/no question — and with a single finger there is only ever one
 * answer. The guard is raised when a card lifts and cleared by the next touch,
 * never by the tap itself, so it does not depend on whether `onPress` or
 * `onTouchEnd` runs first.
 */
let blocked = false;

export const blockTap = (): void => {
  blocked = true;
};

export const allowTap = (): void => {
  blocked = false;
};

/** Wraps a press handler so it does nothing when a drag has just been abandoned. */
export const unlessDragged =
  (handler: () => void): (() => void) =>
  () => {
    if (blocked) return;
    handler();
  };

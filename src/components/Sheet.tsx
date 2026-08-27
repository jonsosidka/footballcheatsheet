'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * The iOS bottom sheet.
 *
 * Chosen over a dropdown because a dropdown anchored to a 32px header button
 * is unhittable one-handed: the sheet puts its rows in the bottom half of the
 * screen where the thumb already is, and it is the presentation people expect
 * for "pick one of these" on a phone.
 *
 * The drag is done by writing `transform` straight to the node rather than
 * through state — a re-render per pointermove drops frames on the exact
 * gesture the illusion depends on. React only hears about the gesture when it
 * resolves, into either a dismiss or a spring back.
 *
 * Above `sm` the same component presents as a centred card. A panel glued to
 * the bottom edge of a desktop display is a long mouse journey from wherever
 * the pointer was.
 */

/** The hydration probe never changes after mount, so it has nothing to notify. */
const subscribeNothing = () => () => {};

/** Pull further than this and the sheet dismisses on release. */
const DISMISS_DISTANCE = 96;
/** ...or flick faster than this, in px/ms, however short the pull was. */
const DISMISS_VELOCITY = 0.55;

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  /*
   * `phase` outlives `open` so the exit animation gets to run: 'closing' keeps
   * the panel mounted until its own animationend says it has finished leaving.
   * Driving the unmount off the animation rather than a matched timeout means
   * the two can never drift apart when the CSS is retuned.
   */
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');

  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startedAt: number; dy: number } | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // `createPortal` needs a real `document`. Read hydration as an external
  // store rather than flipping a flag in an effect: same answer, no extra
  // render pass, and it stays correct if a caller ever mounts this open.
  const portalReady = useSyncExternalStore(subscribeNothing, () => true, () => false);

  /*
   * Adjusted during render rather than in an effect. An effect would paint the
   * panel once in its old phase before correcting it, which on a sheet is a
   * visible flash of the wrong position.
   */
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setPhase(open ? 'open' : phase === 'closed' ? 'closed' : 'closing');
  }

  const present = phase !== 'closed';
  const closing = phase === 'closing';

  // Escape closes, matching every other modal surface on a desktop.
  useEffect(() => {
    if (!present) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [present, onClose]);

  // Freeze the page behind the sheet. Without this the list under the veil
  // scrolls when the drag misses the panel, which reads as a broken modal.
  useEffect(() => {
    if (!present) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [present]);

  // Move focus in on open and hand it back to the trigger on close, so the
  // sheet is operable from a keyboard and does not strand a screen reader.
  useEffect(() => {
    if (!present) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus?.();
    };
  }, [present]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Mice don't fling sheets; leave the pointer free to click through to the
    // rows and let the backdrop and Escape do the dismissing.
    if (event.pointerType === 'mouse') return;
    const panel = panelRef.current;
    if (!panel) return;
    dragRef.current = { startY: event.clientY, startedAt: performance.now(), dy: 0 };
    panel.classList.remove('sheet-settle');
    /*
     * Capture on the grab element, not the panel. React dispatches along the
     * path from the event's target, and capturing retargets every subsequent
     * move to the capturing node — put it on the panel and the moves arrive at
     * an ancestor of this handler, so the drag silently never updates.
     */
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;
    // Downward only — dragging up would peel the sheet off the bottom edge.
    drag.dy = Math.max(0, event.clientY - drag.startY);
    panel.style.transform = `translateY(${drag.dy}px)`;
  }, []);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;
    dragRef.current = null;

    const velocity = drag.dy / Math.max(1, performance.now() - drag.startedAt);
    const dismissed = drag.dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY;

    if (dismissed) {
      onClose();
      return;
    }
    // Didn't clear the threshold: spring back rather than snapping, so a
    // half-hearted pull looks like a decision the sheet made, not a glitch.
    panel.classList.add('sheet-settle');
    panel.style.transform = '';
    setTimeout(() => panel.classList.remove('sheet-settle'), 360);
  }, [onClose]);

  const onAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
    // Child animations bubble; only the panel's own exit ends the sheet.
    if (event.target !== event.currentTarget) return;
    if (phase === 'closing') setPhase('closed');
  };

  if (!portalReady || !present) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 backdrop-blur-[3px] ${closing ? 'veil-out' : 'veil-in'}`}
      />

      <div
        ref={panelRef}
        onAnimationEnd={onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`chrome relative w-full sm:w-[420px] sm:mx-4 max-h-[85dvh] flex flex-col
          bg-ink-raised border-t border-rule-bright sm:border outline-none
          rounded-t-[14px] sm:rounded-[14px] shadow-[0_-8px_40px_rgba(0,0,0,0.55)]
          ${closing ? 'sheet-out' : 'sheet-in'}`}
      >
        {/* Grab area: the handle and the title are both draggable, which is
            how iOS behaves — the whole header is the grip, not just the bar. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="shrink-0 pt-2.5 px-4 pb-3 border-b border-rule touch-none"
        >
          <div className="sm:hidden mx-auto mb-3 h-1 w-9 rounded-full bg-rule-bright" aria-hidden="true" />
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="eyebrow">{title}</h2>
            {subtitle ? <span className="eyebrow text-text-faint">{subtitle}</span> : null}
          </div>
        </div>

        <div className="overflow-y-auto scroll-contain flex-1">{children}</div>

        {/* Explicit dismiss for the standalone case, where there is no browser
            chrome to fall back on, plus the home-indicator inset. */}
        <div className="shrink-0 border-t border-rule pb-safe">
          <button
            type="button"
            onClick={onClose}
            className="press w-full h-[52px] text-[13px] text-text-dim active:bg-ink-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

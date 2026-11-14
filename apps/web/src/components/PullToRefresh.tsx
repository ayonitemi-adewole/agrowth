import { ArrowDown, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PULL_THRESHOLD, pullDistance, refreshAll } from '../lib/refresh';
import { cx } from './ui';

/**
 * Touches that start here belong to something else: a map being panned or drawn on, a
 * form field, an open dialog or menu, or anything marked data-no-pull.
 */
const OWN_GESTURES =
  '.leaflet-container, input, textarea, select, [contenteditable="true"], dialog, [data-no-pull]';

/** The finger is on something scrolled down inside the page; dragging should scroll it back. */
function insideScrolledBox(el: Element | null): boolean {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.scrollTop > 0) return true;
  }
  return false;
}

/** The spinner stays at least this long, so a fast refresh still reads as one. */
const MIN_SPIN_MS = 450;

/**
 * Pull down from the top of a page to load its data again (touch screens). It reloads
 * what's on screen without reloading the page, so unsaved work stays put, and it sends any
 * field visits waiting on the phone.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    // The browser's own pull-to-refresh reloads the whole app and loses anything unsaved;
    // this one replaces it while the signed-in app is open.
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'contain';

    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;

    const reset = () => {
      start = null;
      pulling = false;
      distance = 0;
    };

    const onStart = (e: TouchEvent) => {
      reset();
      if (busy.current || e.touches.length !== 1 || window.scrollY > 0) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(OWN_GESTURES) || document.querySelector('dialog[open]')) return;
      if (insideScrolledBox(target)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = e.touches[0].clientX - start.x;
      if (!pulling) {
        // Wait until it's clearly a downward pull; a sideways swipe or a scroll isn't one.
        if (Math.abs(dx) > 10 && Math.abs(dx) > dy) return reset();
        if (dy < -4 || window.scrollY > 0) return reset();
        if (dy < 10) return;
        pulling = true;
      }
      e.preventDefault();
      distance = pullDistance(dy - 10);
      setPull(distance);
    };

    const onEnd = async () => {
      const wasPulling = pulling;
      const far = distance >= PULL_THRESHOLD;
      reset();
      if (!wasPulling) return;
      if (!far) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(PULL_THRESHOLD);
      if ('vibrate' in navigator) navigator.vibrate?.(10);
      const started = Date.now();
      try {
        await refreshAll();
      } finally {
        const left = MIN_SPIN_MS - (Date.now() - started);
        if (left > 0) await new Promise((r) => setTimeout(r, left));
        setRefreshing(false);
        setPull(0);
        busy.current = false;
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      root.style.overscrollBehaviorY = before;
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const ready = pull >= PULL_THRESHOLD;
  const shown = pull > 0 || refreshing;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center lg:top-3"
      aria-hidden={!refreshing}
    >
      <div
        role="status"
        className={cx(
          'flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-lg ring-1 ring-zinc-950/10',
          // Springs back into place when released; follows the finger while pulling.
          pull === 0 || refreshing ? 'transition-all duration-200 ease-out' : '',
        )}
        style={{
          transform: `translateY(${shown ? pull - 48 : -72}px)`,
          opacity: refreshing ? 1 : Math.min(1, pull / (PULL_THRESHOLD * 0.6)),
        }}
      >
        {refreshing ? (
          <RefreshCw className="size-4 animate-spin text-brand-700" aria-hidden />
        ) : (
          <ArrowDown
            className={cx('size-4 transition-transform', ready ? 'rotate-180 text-brand-700' : '')}
            aria-hidden
          />
        )}
        <span>{refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}</span>
      </div>
    </div>
  );
}

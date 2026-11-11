import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import {
  Router,
  UNSAFE_createBrowserHistory as createBrowserHistory,
  useLocation,
  useNavigationType,
} from 'react-router';

/*
 * The app's router: React Router's <BrowserRouter>, plus knowing when a page change is
 * still on its way.
 *
 * <BrowserRouter> runs every navigation as a React transition: while the next screen's code
 * or data is loading, the current screen stays up instead of flashing a blank fallback.
 * That's the smooth part, but on its own it gives no feedback, so a click can feel ignored.
 * Here the same transition is tracked with useTransition, and <RouteProgress> shows a thin
 * bar at the top of the window while it's pending.
 */

const PendingContext = createContext(false);

export function AppRouter({ children }: { children: ReactNode }) {
  const [history] = useState(() => createBrowserHistory({ window, v5Compat: true }));
  const [state, setState] = useState({ action: history.action, location: history.location });
  const [pending, startTransition] = useTransition();

  useLayoutEffect(() => history.listen((next) => startTransition(() => setState(next))), [history]);

  return (
    <PendingContext.Provider value={pending}>
      <Router location={state.location} navigationType={state.action} navigator={history}>
        {children}
      </Router>
    </PendingContext.Provider>
  );
}

/** True while a page change has started but the new screen isn't ready yet. */
export function useNavigationPending(): boolean {
  return useContext(PendingContext);
}

/**
 * A slim progress bar along the top edge while a page change is pending. It waits a beat
 * before appearing, so instant navigations show nothing, then finishes and fades out.
 */
export function RouteProgress() {
  const pending = useNavigationPending();
  // Shown a beat after a change starts; hidden a little after it ends, once the bar has
  // filled and faded.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(pending), pending ? 120 : 350);
    return () => clearTimeout(t);
  }, [pending]);

  if (!visible) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
      role="progressbar"
      aria-label="Loading page"
    >
      <div
        className={
          pending
            ? 'h-full w-full origin-left animate-route-progress bg-brand-500 shadow-[0_0_8px] shadow-brand-500/60'
            : 'h-full w-full origin-left bg-brand-500 opacity-0 transition-opacity duration-300'
        }
      />
    </div>
  );
}

/**
 * New screens open at the top, as a full page load would. Back and forward keep the
 * browser's own behaviour, and links to an #anchor on the same page are left alone.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (type !== 'POP') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Only a new path counts; `type` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
}

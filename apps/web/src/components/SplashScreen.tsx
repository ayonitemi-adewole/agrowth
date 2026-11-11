import { useEffect, useState } from 'react';
import { useAuth, type AuthTransition } from '../auth/AuthProvider';

/**
 * The splash screen, while the app starts: the same markup as the one in index.html, which
 * shows before any script loads, so the hand-over is seamless. Its styles are in
 * index.html too.
 *
 * `inline` is the smaller version for the page area while a screen loads, with the menu
 * still in place. It appears after a short delay, so quick loads show nothing at all.
 * `message` replaces the tagline, e.g. "Signing you out…". `leaving` fades it out.
 */
export function SplashScreen({
  inline = false,
  message,
  leaving = false,
}: {
  inline?: boolean;
  message?: string;
  leaving?: boolean;
}) {
  return (
    <div
      className={['splash', inline && 'splash-inline', leaving && 'splash-leaving']
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
    >
      <div className="splash-mark" aria-hidden>
        <svg
          viewBox="6.5 4.5 20 23"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 26V13" />
          <path className="splash-leaf right" d="M16 13c0-4 3-7 7-7 0 4-3 7-7 7Z" />
          <path className="splash-leaf left" d="M16 17c0-3.5-2.6-6-6-6 0 3.5 2.6 6 6 6Z" />
        </svg>
      </div>
      {!inline && (
        <div>
          <div className="splash-name">Agrowth</div>
          <div className="splash-tag">{message ?? 'Verifiable farm finance'}</div>
        </div>
      )}
      <div className="splash-bar" aria-hidden />
      <span className="splash-sr">{message ?? (inline ? 'Loading…' : 'Loading Agrowth…')}</span>
    </div>
  );
}

/** How long the loading screen takes to fade out; matches .splash-leaving in index.html. */
const FADE_MS = 220;

/**
 * The full-screen loading screen during sign-in, sign-out and account switches. Everything
 * behind it changes while it's up; it then fades away to reveal the next screen.
 */
export function AuthTransitionScreen() {
  const { transition } = useAuth();
  // The last transition shown, kept through the fade-out after it ends.
  const [shown, setShown] = useState<AuthTransition | null>(transition);
  if (transition && transition !== shown) setShown(transition);
  const leaving = !transition && shown !== null;

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setShown(null), FADE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!shown) return null;
  return <SplashScreen message={shown.message} leaving={leaving} />;
}

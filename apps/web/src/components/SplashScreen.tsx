/**
 * The splash screen, while the app starts: the same markup as the one in index.html, which
 * shows before any script loads, so the hand-over is seamless. Its styles are in
 * index.html too.
 *
 * `inline` is the smaller version for the page area while a screen loads, with the menu
 * still in place. It appears after a short delay, so quick loads show nothing at all.
 */
export function SplashScreen({ inline = false }: { inline?: boolean }) {
  return (
    <div className={inline ? 'splash splash-inline' : 'splash'} role="status" aria-live="polite">
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
          <div className="splash-tag">Verifiable farm finance</div>
        </div>
      )}
      <div className="splash-bar" aria-hidden />
      <span className="splash-sr">{inline ? 'Loading…' : 'Loading Agrowth…'}</span>
    </div>
  );
}

/**
 * Pull to refresh: everything on screen that loads data registers here, and a pull asks
 * each of them to load again. It reloads the data, not the page, so a half-filled form,
 * photos already taken or a GPS fix on screen are kept.
 */
type Refresher = () => Promise<unknown>;

const refreshers = new Set<Refresher>();

/** Registers something to reload on a pull. Returns the function that unregisters it. */
export function onRefresh(refresher: Refresher): () => void {
  refreshers.add(refresher);
  return () => {
    refreshers.delete(refresher);
  };
}

/**
 * Reloads everything registered and resolves once all of it has finished (or failed), or
 * after `timeoutMs`, so the spinner never sticks on a request that hangs.
 */
export async function refreshAll(timeoutMs = 15_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const all = Promise.allSettled([...refreshers].map((r) => r()));
  await Promise.race([all, timeout]);
  clearTimeout(timer);
}

/** How far a pull has to travel, in pixels after resistance, to refresh on release. */
export const PULL_THRESHOLD = 72;
/** The furthest the indicator moves, however far the finger goes. */
export const PULL_MAX = 112;

/** A finger's travel turned into the indicator's: half speed, then it stops at PULL_MAX. */
export const pullDistance = (fingerTravel: number) =>
  Math.max(0, Math.min(PULL_MAX, fingerTravel * 0.5));

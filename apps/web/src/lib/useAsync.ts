import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  /** The latest result. Kept while a reload is in flight, so the page doesn't flash empty. */
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `load` whenever `deps` change, and exposes loading/error state.
 * `deps` must be simple values (ids, search text, page numbers).
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const key = `${JSON.stringify(deps)}#${tick}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: unknown }>();

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => !cancelled && setResult({ key, data }),
      (error: unknown) => !cancelled && setResult((prev) => ({ key, data: prev?.data, error })),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const loading = result?.key !== key;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: result?.data, error: loading ? undefined : result?.error, loading, reload };
}

/** The value, once it has stopped changing for `ms` — so search doesn't query on every keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

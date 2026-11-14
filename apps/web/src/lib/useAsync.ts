import { useCallback, useEffect, useRef, useState } from 'react';
import { onRefresh } from './refresh';

export interface AsyncState<T> {
  /** The latest result. Kept while a reload is in flight, so the page doesn't flash empty. */
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /**
   * The data is from before `deps` changed (another farmer, another cycle). Lists can keep
   * showing it while the new results load; a detail page should show its skeleton instead
   * of the previous record.
   */
  stale: boolean;
  reload: () => void;
}

export interface AsyncOptions {
  /**
   * Load again when the person pulls the page down to refresh (default true). Turn it off
   * for a load with side effects, such as confirming a payment or checking a scanned voucher.
   */
  refresh?: boolean;
}

/**
 * Runs `load` whenever `deps` change, and exposes loading/error state. It also runs again
 * on pull to refresh, unless `options.refresh` is false.
 * `deps` must be simple values (ids, search text, page numbers).
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  options: AsyncOptions = {},
): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const depsKey = JSON.stringify(deps);
  const key = `${depsKey}#${tick}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: unknown }>();

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  // Pulls waiting for the next load to finish, so the spinner stops when the data is in.
  const waiting = useRef<(() => void)[]>([]);
  const settle = () => waiting.current.splice(0).forEach((done) => done());

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (cancelled) return;
        setResult({ key, data });
        settle();
      },
      (error: unknown) => {
        if (cancelled) return;
        setResult((prev) => ({ key, data: prev?.data, error }));
        settle();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const refreshable = options.refresh !== false;
  useEffect(() => {
    if (!refreshable) return;
    const off = onRefresh(
      () =>
        new Promise<void>((resolve) => {
          waiting.current.push(resolve);
          setTick((t) => t + 1);
        }),
    );
    return () => {
      off();
      settle();
    };
  }, [refreshable]);

  const loading = result?.key !== key;
  const stale = result !== undefined && !result.key.startsWith(`${depsKey}#`);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: result?.data, error: loading ? undefined : result?.error, loading, stale, reload };
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

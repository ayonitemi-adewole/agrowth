import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRefresh, PULL_MAX, pullDistance, refreshAll } from './refresh';

describe('pull to refresh', () => {
  afterEach(() => vi.useRealTimers());

  it('reloads everything registered and waits for all of it', async () => {
    const done: string[] = [];
    const offA = onRefresh(async () => void done.push('a'));
    const offB = onRefresh(() => new Promise((r) => setTimeout(() => r(done.push('b')), 5)));
    await refreshAll();
    expect(done.sort()).toEqual(['a', 'b']);
    offA();
    offB();
  });

  it('stops asking once unregistered, and a failure does not stop the others', async () => {
    const calls: string[] = [];
    const off = onRefresh(async () => void calls.push('gone'));
    off();
    const offFail = onRefresh(async () => {
      throw new Error('offline');
    });
    const offOk = onRefresh(async () => void calls.push('ok'));
    await refreshAll();
    expect(calls).toEqual(['ok']);
    offFail();
    offOk();
  });

  it('gives up waiting on something that hangs', async () => {
    vi.useFakeTimers();
    const off = onRefresh(() => new Promise(() => {}));
    const finished = refreshAll(1_000).then(() => 'finished');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await finished).toBe('finished');
    off();
  });

  it('moves the indicator at half the finger’s speed, up to a limit', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(100)).toBe(50);
    expect(pullDistance(10_000)).toBe(PULL_MAX);
  });
});

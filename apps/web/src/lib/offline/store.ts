import type { QueuedVisit, Snapshot } from './types';

/**
 * The phone's own storage (IndexedDB) for working without a connection: the agent's work
 * list ("snapshots", one per signed-in user) and visits waiting to be sent ("outbox").
 * Photos are stored as they were taken, so their metadata survives for later checks.
 */
const DB_NAME = 'agrowth-field';
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('userId', 'userId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

async function run<T>(
  store: 'snapshots' | 'outbox',
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage on this phone is full'));
  });
}

export const available = () => typeof indexedDB !== 'undefined';

export const snapshots = {
  get: (userId: string) => run<Snapshot | undefined>('snapshots', 'readonly', (s) => s.get(userId)),
  put: (snap: Snapshot) => run('snapshots', 'readwrite', (s) => s.put(snap)).then(() => {}),
  remove: (userId: string) => run('snapshots', 'readwrite', (s) => s.delete(userId)).then(() => {}),
};

/** The outbox, as the sync engine needs it. */
export interface Outbox {
  list(userId: string): Promise<QueuedVisit[]>;
  put(visit: QueuedVisit): Promise<void>;
  remove(id: string): Promise<void>;
}

export const outbox: Outbox = {
  list: (userId) =>
    run<QueuedVisit[]>('outbox', 'readonly', (s) => s.index('userId').getAll(userId)).then((v) =>
      v.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ),
  put: (visit) => run('outbox', 'readwrite', (s) => s.put(visit)).then(() => {}),
  remove: (id) => run('outbox', 'readwrite', (s) => s.delete(id)).then(() => {}),
};

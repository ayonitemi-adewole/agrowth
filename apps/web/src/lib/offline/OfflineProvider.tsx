import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { onRefresh } from '../refresh';
import { can } from '../roles';
import { supabase } from '../supabase';
import { available, outbox } from './store';
import { syncOutbox, type Remote, type SyncReport } from './sync';
import type { QueuedVisit, VisitResult } from './types';

interface OfflineState {
  /** The browser's view of the connection. */
  online: boolean;
  /** This agent's queued, failed and recently synced visits, oldest first. */
  visits: QueuedVisit[];
  pending: number;
  failed: number;
  syncing: boolean;
  lastSyncAt: Date | null;
  /** Saves a visit on the phone, then tries to send it straight away. */
  queue: (visit: QueuedVisit) => Promise<QueuedVisit>;
  syncNow: () => Promise<SyncReport | null>;
  /** Drops a visit from the phone, e.g. one the database refused. */
  discard: (id: string) => Promise<void>;
}

const OfflineContext = createContext<OfflineState | null>(null);

const remote: Remote = {
  upload: async (path, photo) => {
    const { error } = await supabase.storage
      .from('field-photos')
      .upload(path, photo.blob, { contentType: photo.type || 'image/jpeg', upsert: false });
    // Already there from an earlier attempt that lost its connection on the way back.
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  },
  recordVisit: async (v, paths) => {
    const { data, error } = await supabase.rpc('record_field_visit', {
      p_farm_id: v.farmId,
      p_milestone_id: v.milestoneId,
      p_lon: v.fix.lon,
      p_lat: v.fix.lat,
      p_gps_accuracy_m: Math.round(v.fix.accuracy * 10) / 10,
      p_crop_condition: v.condition,
      p_checklist_passed: v.checklistPassed,
      p_photo_paths: paths,
      p_notes: v.notes,
      p_visited_at: v.fix.at,
      p_client_ref: v.id,
    });
    if (error) throw error;
    return data as VisitResult;
  },
};

/** Keeps field agents' queued visits moving: syncs on start, on reconnect and every minute. */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { profile, session } = useAuth();
  const userId = profile && can.doFieldVisits(profile.role) ? profile.id : null;
  const [online, setOnline] = useState(() => navigator.onLine);
  const [visits, setVisits] = useState<QueuedVisit[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId || !available()) {
      setVisits([]);
      return;
    }
    setVisits(await outbox.list(userId));
  }, [userId]);

  const syncNow = useCallback(async () => {
    // Needs a real sign-in; an offline session (cached profile only) can't send.
    if (!userId || !session || !available() || busy.current || !navigator.onLine) return null;
    busy.current = true;
    setSyncing(true);
    try {
      const report = await syncOutbox(outbox, remote, userId);
      setLastSyncAt(new Date());
      return report;
    } finally {
      busy.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [userId, session, refresh]);

  const queue = useCallback(
    async (visit: QueuedVisit) => {
      await outbox.put(visit);
      await refresh();
      await syncNow();
      return (await outbox.list(visit.userId)).find((v) => v.id === visit.id) ?? visit;
    },
    [refresh, syncNow],
  );

  const discard = useCallback(
    async (id: string) => {
      await outbox.remove(id);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // Load the queue when the agent signs in, and send it whenever there's a connection.
  useEffect(() => {
    const t = setTimeout(() => void refresh().then(() => (online ? syncNow() : null)), 0);
    return () => clearTimeout(t);
  }, [refresh, syncNow, online]);

  // Pulling a page down to refresh also sends what's waiting on the phone.
  useEffect(() => onRefresh(() => syncNow()), [syncNow]);

  const pending = visits.filter((v) => v.state === 'queued').length;
  useEffect(() => {
    if (!online || pending === 0) return;
    const t = setInterval(() => void syncNow(), 60_000);
    return () => clearInterval(t);
  }, [online, pending, syncNow]);

  return (
    <OfflineContext.Provider
      value={{
        online,
        visits,
        pending,
        failed: visits.filter((v) => v.state === 'failed').length,
        syncing,
        lastSyncAt,
        queue,
        syncNow,
        discard,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline(): OfflineState {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside <OfflineProvider>');
  return ctx;
}

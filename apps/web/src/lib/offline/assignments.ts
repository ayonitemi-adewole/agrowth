import { supabase } from '../supabase';
import type { FarmMap } from '../types';
import { available, snapshots } from './store';
import { isNetworkError } from './sync';
import type { Assignment, CheckAssignment, VisitFarm } from './types';

type FarmRow = FarmMap & { farmers: { full_name: string } };

const visitFarm = (f: FarmRow): VisitFarm => ({
  id: f.id,
  name: f.name,
  area_hectares: f.area_hectares,
  primary_crop: f.primary_crop,
  boundary: f.boundary,
  centroid_lon: f.centroid_lon,
  centroid_lat: f.centroid_lat,
  farmer: f.farmers.full_name,
});

/** Milestones awaiting verification and their farms, with boundaries, from the server. */
async function fetchAssignments(): Promise<Assignment[]> {
  const { data: milestones, error } = await supabase
    .from('milestones')
    .select(
      'id, sequence, name, status, verification_requested_at, cycle_id, cycles(code, crop, season)',
    )
    .in('status', ['awaiting_verification', 'blocked'])
    .order('verification_requested_at');
  if (error) throw error;
  if (!milestones.length) return [];

  type Row = (typeof milestones)[number] & {
    cycles: { code: string; crop: string; season: string };
  };
  const cycleIds = [...new Set(milestones.map((m) => m.cycle_id as string))];
  const links = await supabase
    .from('cycle_farms')
    .select('cycle_id, farm_id')
    .in('cycle_id', cycleIds);
  if (links.error) throw links.error;
  const farmIds = [...new Set(links.data.map((l) => l.farm_id as string))];

  const [farms, visits] = await Promise.all([
    supabase.from('farm_maps').select('*, farmers(full_name)').in('id', farmIds),
    supabase
      .from('field_visits')
      .select('farm_id, milestone_id, passed, visited_at')
      .in(
        'milestone_id',
        milestones.map((m) => m.id as string),
      )
      .order('visited_at', { ascending: false }),
  ]);
  if (farms.error) throw farms.error;
  if (visits.error) throw visits.error;
  const byId = new Map((farms.data as FarmRow[]).map((f) => [f.id, f]));

  return (milestones as unknown as Row[]).map((m) => ({
    milestone: {
      id: m.id,
      sequence: m.sequence,
      name: m.name,
      status: m.status,
      verification_requested_at: m.verification_requested_at,
      cycle: m.cycles,
    },
    farms: links.data
      .filter((l) => l.cycle_id === m.cycle_id)
      .map((l) => byId.get(l.farm_id))
      .filter((f) => f !== undefined)
      .map((f) => {
        const latest = visits.data.find(
          (v) =>
            v.milestone_id === m.id &&
            v.farm_id === f.id &&
            (!m.verification_requested_at || v.visited_at >= m.verification_requested_at),
        );
        return {
          ...visitFarm(f),
          latest: latest ? { passed: latest.passed, visited_at: latest.visited_at } : null,
        };
      }),
  }));
}

/** Running cycles and when each of their farms is due its next routine check. */
async function fetchChecks(): Promise<CheckAssignment[]> {
  const { data: due, error } = await supabase
    .from('farm_check_schedule')
    .select('cycle_id, farm_id, interval_days, next_due_on, last_check_at')
    .order('next_due_on');
  if (error) throw error;
  if (!due.length) return [];

  const [cycles, farms] = await Promise.all([
    supabase
      .from('cycles')
      .select('id, code, crop, season')
      .in('id', [...new Set(due.map((d) => d.cycle_id as string))]),
    supabase
      .from('farm_maps')
      .select('*, farmers(full_name)')
      .in('id', [...new Set(due.map((d) => d.farm_id as string))]),
  ]);
  if (cycles.error) throw cycles.error;
  if (farms.error) throw farms.error;
  const farmById = new Map((farms.data as FarmRow[]).map((f) => [f.id, f]));

  return (cycles.data as { id: string; code: string; crop: string; season: string }[])
    .map((c) => {
      const rows = due.filter((d) => d.cycle_id === c.id);
      return {
        cycle: { ...c, interval_days: rows[0].interval_days as number },
        farms: rows
          .filter((d) => farmById.has(d.farm_id))
          .map((d) => ({
            ...visitFarm(farmById.get(d.farm_id)!),
            next_due_on: d.next_due_on as string,
            last_check_at: d.last_check_at as string | null,
          })),
      };
    })
    .sort((a, b) =>
      (a.farms[0]?.next_due_on ?? '9999').localeCompare(b.farms[0]?.next_due_on ?? '9999'),
    );
}

export interface WorkList {
  assignments: Assignment[];
  /** Routine farm checks, soonest due first. */
  checks: CheckAssignment[];
  /** When the list was downloaded; for a fresh list, now. */
  savedAt: string;
  /** True when the server couldn't be reached and this is the copy on the phone. */
  fromPhone: boolean;
}

/**
 * The agent's work list: fresh from the server when there's a connection (and saved on
 * the phone for later), or the saved copy when there isn't.
 */
export async function loadWorkList(userId: string): Promise<WorkList> {
  try {
    const [assignments, checks] = await Promise.all([fetchAssignments(), fetchChecks()]);
    const savedAt = new Date().toISOString();
    if (available()) {
      await snapshots.put({ userId, savedAt, assignments, checks }).catch(() => {});
    }
    return { assignments, checks, savedAt, fromPhone: false };
  } catch (err) {
    if (!isNetworkError(err) || !available()) throw err;
    const saved = await snapshots.get(userId);
    if (!saved) {
      throw new Error(
        "You're offline and this phone has no saved work list yet. Open Field visits once with a connection to save it.",
        { cause: err },
      );
    }
    return {
      assignments: saved.assignments,
      checks: saved.checks ?? [],
      savedAt: saved.savedAt,
      fromPhone: true,
    };
  }
}

/** Loads the code for visiting a farm now, so it's on the phone before the agent leaves coverage. */
export function warmUpVisitPage() {
  void import('../../pages/FieldVisitPage');
  void import('../../components/FarmMap');
}

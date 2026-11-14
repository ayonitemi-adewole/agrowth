import type { Polygon } from 'geojson';
import type { CropCondition, MilestoneStatus } from '../types';

/** A farm with what's needed to visit it without a connection. */
export interface VisitFarm {
  id: string;
  name: string | null;
  area_hectares: number;
  primary_crop: string | null;
  boundary: Polygon;
  centroid_lon: number;
  centroid_lat: number;
  farmer: string;
}

/** A farm the agent has to visit for a milestone. */
export interface AssignedFarm extends VisitFarm {
  /** The latest visit since verification was requested, when the list was saved. */
  latest: { passed: boolean; visited_at: string } | null;
}

/** A farm due a routine check, as it stood when the list was saved. */
export interface CheckFarm extends VisitFarm {
  /** The day its next check is due (Nigerian date, YYYY-MM-DD). */
  next_due_on: string;
  /** The last check made at the farm; null if there hasn't been one. */
  last_check_at: string | null;
}

/** A running cycle whose farms are checked every interval_days, separate from milestones. */
export interface CheckAssignment {
  cycle: { id: string; code: string; crop: string; season: string; interval_days: number };
  farms: CheckFarm[];
}

/** A milestone waiting for field verification, and its farms. */
export interface Assignment {
  milestone: {
    id: string;
    sequence: number;
    name: string;
    status: MilestoneStatus;
    verification_requested_at: string | null;
    cycle: { code: string; crop: string; season: string };
  };
  farms: AssignedFarm[];
}

/** The agent's work list as last downloaded, kept on the phone for offline use. */
export interface Snapshot {
  userId: string;
  savedAt: string;
  assignments: Assignment[];
  /** Routine checks. Missing from lists saved before routine checks existed. */
  checks?: CheckAssignment[];
}

export interface QueuedPhoto {
  name: string;
  type: string;
  blob: Blob;
}

/** A milestone verification visit, or a routine check of the farm. */
export type VisitKind = 'milestone' | 'check';

/** A visit saved on the phone, waiting to be sent (or already sent, with its result). */
export interface QueuedVisit {
  /** The phone's id for the visit; sent as client_ref so a resend can't count twice. */
  id: string;
  userId: string;
  farmId: string;
  /** Visits saved before routine checks existed have none: they're milestone visits. */
  kind?: VisitKind;
  /** For a milestone visit. */
  milestoneId?: string;
  /** For a routine check. */
  cycleId?: string;
  /** For showing the queue without the network: "Amina Ibrahim · KD-MAIZE-26W-01 #1". */
  farmLabel: string;
  /** What the visit was for: the milestone, or "routine check" and the cycle. */
  milestoneLabel: string;
  fix: { lon: number; lat: number; accuracy: number; at: string };
  condition: CropCondition;
  /** Milestone visits only; true for routine checks, which have no checklist. */
  checklistPassed: boolean;
  notes: string | null;
  /** The portrait of the farmer. Visits saved before portraits were required have none. */
  portrait?: QueuedPhoto | null;
  /** Photos of the farm. */
  photos: QueuedPhoto[];
  createdAt: string;
  state: 'queued' | 'failed' | 'synced';
  attempts: number;
  /** Photo uploads already done, so a retry doesn't repeat them. */
  uploaded: string[];
  /** Why the database refused it, when state is 'failed'. */
  error?: string;
  /** What the database decided, once synced: a VisitResult or, for a check, a CheckResult. */
  result?: VisitResult | CheckResult;
  syncedAt?: string;
}

export interface VisitResult {
  visit_id: string;
  passed: boolean;
  gps_ok: boolean;
  distance_from_boundary_m: number;
  milestone_status: string;
  has_portrait?: boolean;
  duplicate?: boolean;
}

/** What the database said about a routine check. */
export interface CheckResult {
  check_id: string;
  /** Made at the farm, so it counts towards the schedule. */
  gps_ok: boolean;
  distance_from_boundary_m: number;
  /** When the farm's next check is due, after this one. */
  next_due_on: string | null;
  duplicate?: boolean;
}

export const visitKind = (v: Pick<QueuedVisit, 'kind'>): VisitKind => v.kind ?? 'milestone';

export const isCheckResult = (r: VisitResult | CheckResult | undefined): r is CheckResult =>
  !!r && 'check_id' in r;

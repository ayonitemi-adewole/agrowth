import type { Polygon } from 'geojson';
import type { CropCondition, MilestoneStatus } from '../types';

/** A farm the agent has to visit, with what's needed to visit it without a connection. */
export interface AssignedFarm {
  id: string;
  name: string | null;
  area_hectares: number;
  primary_crop: string | null;
  boundary: Polygon;
  centroid_lon: number;
  centroid_lat: number;
  farmer: string;
  /** The latest visit since verification was requested, when the list was saved. */
  latest: { passed: boolean; visited_at: string } | null;
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
}

export interface QueuedPhoto {
  name: string;
  type: string;
  blob: Blob;
}

/** A visit saved on the phone, waiting to be sent (or already sent, with its result). */
export interface QueuedVisit {
  /** The phone's id for the visit; sent as client_ref so a resend can't count twice. */
  id: string;
  userId: string;
  farmId: string;
  milestoneId: string;
  /** For showing the queue without the network: "Amina Ibrahim · KD-MAIZE-26W-01 #1". */
  farmLabel: string;
  milestoneLabel: string;
  fix: { lon: number; lat: number; accuracy: number; at: string };
  condition: CropCondition;
  checklistPassed: boolean;
  notes: string | null;
  photos: QueuedPhoto[];
  createdAt: string;
  state: 'queued' | 'failed' | 'synced';
  attempts: number;
  /** Photo uploads already done, so a retry doesn't repeat them. */
  uploaded: string[];
  /** Why the database refused it, when state is 'failed'. */
  error?: string;
  /** What the database decided, once synced. */
  result?: VisitResult;
  syncedAt?: string;
}

export interface VisitResult {
  visit_id: string;
  passed: boolean;
  gps_ok: boolean;
  distance_from_boundary_m: number;
  milestone_status: string;
  duplicate?: boolean;
}

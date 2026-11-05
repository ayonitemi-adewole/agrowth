import { supabase } from './supabase';
import type { CycleStatus, MilestoneStatus, PayeeKind } from './types';

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

export const CYCLE_STATUS: Record<CycleStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_approval: { label: 'Awaiting approval', tone: 'amber' },
  open_for_funding: { label: 'Open for funding', tone: 'blue' },
  funded: { label: 'Funded', tone: 'violet' },
  in_progress: { label: 'In progress', tone: 'green' },
  harvested: { label: 'Harvested', tone: 'green' },
  settled: { label: 'Settled', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  refunded: { label: 'Refunded', tone: 'red' },
};

export const MILESTONE_STATUS: Record<MilestoneStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Not started', tone: 'neutral' },
  awaiting_verification: { label: 'Awaiting field visits', tone: 'amber' },
  blocked: { label: 'Blocked', tone: 'red' },
  verified: { label: 'Verified', tone: 'blue' },
  released: { label: 'Released', tone: 'green' },
};

export const PAYEE_KIND: Record<PayeeKind, string> = {
  input_vendor: 'Input vendor',
  service_provider: 'Service provider',
  farmer_cash: 'Cash to farmers',
};

export const FUNDING_SOURCE = {
  investor: 'Investors',
  programme: 'Government / donor programme',
  blended: 'Blended (programme + investors)',
} as const;

/**
 * Uploads a file to a private storage bucket under `folder/` and returns its path.
 * Documents are never overwritten: each upload gets a unique name.
 */
export async function uploadFile(bucket: string, folder: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80);
  const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

/** Opens a private file in a new tab via a short-lived signed link. */
export async function openFile(bucket: string, path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}

/** "2027-03-14" → today + n days, for date inputs. */
export const isoDate = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

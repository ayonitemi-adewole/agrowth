/** The shape of an error from Supabase (PostgREST) or Supabase Auth. */
export interface ApiError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

export interface OverlappingFarm {
  farm_id: string;
  farmer_id: string;
  overlap_hectares: number;
}

/** A plain-language message for an error coming back from the database. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong';
  const e = err as ApiError;
  switch (e.code) {
    case '42501':
    case 'PT403':
      return e.code === 'PT403' ? e.message : 'Your role does not allow this action';
    case '23505':
      return 'This record already exists';
    case '23514':
      return 'Some details are not in the expected format';
    case 'PGRST301':
    case 'PGRST303':
      return 'Your session has expired. Please sign in again.';
  }
  if (e.message === 'Failed to fetch') {
    return 'Could not reach the server. Check your internet connection.';
  }
  return e.message || 'Something went wrong';
}

/** The existing farmer's id when enrolment was refused as a duplicate. */
export function duplicateFarmerId(err: unknown): string | null {
  const e = err as ApiError | null;
  return e?.code === 'PT409' && e.details && /^[0-9a-f-]{36}$/.test(e.details) ? e.details : null;
}

/** The farms a boundary clashed with, when mapping was refused for overlap. */
export function overlappingFarms(err: unknown): OverlappingFarm[] {
  const e = err as ApiError | null;
  if (e?.code !== 'PT409' || !e.details?.startsWith('[')) return [];
  try {
    return JSON.parse(e.details) as OverlappingFarm[];
  } catch {
    return [];
  }
}

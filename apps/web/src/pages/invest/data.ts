import { supabase } from '../../lib/supabase';
import type { InvestorProfile, InvestorSettings } from '../../lib/types';

/** The signed-in investor's KYC record, or null if they haven't submitted one. */
export async function loadMyInvestorProfile(): Promise<InvestorProfile | null> {
  const { data, error } = await supabase.from('investor_profiles').select('*').maybeSingle();
  if (error) throw error;
  return data as InvestorProfile | null;
}

export async function loadInvestorSettings(): Promise<InvestorSettings> {
  const { data, error } = await supabase.from('investor_settings').select('*').single();
  if (error) throw error;
  return data as InvestorSettings;
}

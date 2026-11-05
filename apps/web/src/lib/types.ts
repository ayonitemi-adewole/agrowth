import type { Polygon } from 'geojson';

export type Role =
  | 'admin'
  | 'cycle_manager'
  | 'field_agent'
  | 'compliance_officer'
  | 'auditor'
  | 'investor'
  | 'programme_manager'
  | 'vendor'
  | 'offtaker';

export type KycStatus = 'pending' | 'verified' | 'rejected';
export type Gender = 'female' | 'male' | 'other';
export type TenureType = 'owned' | 'leased' | 'communal' | 'family' | 'other';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Cooperative {
  id: string;
  name: string;
  registration_number: string | null;
  state: string;
  lga: string;
  ward: string | null;
  contact_phone: string | null;
  created_at: string;
}

export interface Farmer {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  gender: Gender | null;
  date_of_birth: string | null;
  nin_last4: string | null;
  bvn_last4: string | null;
  kyc_status: KycStatus;
  state: string;
  lga: string;
  ward: string | null;
  photo_url: string | null;
  cooperative_id: string | null;
  registered_by: string;
  created_at: string;
}

/** A row of the farm_maps view: a farm with its boundary as GeoJSON. */
export interface FarmMap {
  id: string;
  farmer_id: string;
  name: string | null;
  area_hectares: number;
  primary_crop: string | null;
  tenure_type: TenureType;
  tenure_document_url: string | null;
  soil_notes: string | null;
  boundary: Polygon;
  centroid_lon: number;
  centroid_lat: number;
  cooperative_id: string | null;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

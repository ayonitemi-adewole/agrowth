import { supabase } from './supabase';

/**
 * Uploads a photo taken at enrolment (the farmer's portrait, or the farm's condition) to
 * "registry-photos" under the agent's own id, which is where the database expects it.
 * Returns the stored path.
 */
export async function uploadRegistryPhoto(
  agentId: string,
  file: File,
  label: 'portrait' | 'farm',
): Promise<string> {
  const ext = (file.name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? 'jpg').toLowerCase();
  const path = `${agentId}/${crypto.randomUUID()}-${label}.${ext}`;
  const { error } = await supabase.storage
    .from('registry-photos')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

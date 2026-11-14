import { Crosshair, LocateFixed, Trash2, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { FarmMap } from '../components/FarmMap';
import { PhotoPicker } from '../components/Photos';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  Textarea,
} from '../components/ui';
import { errorMessage, overlappingFarms, type OverlappingFarm } from '../lib/errors';
import { formatHectares } from '../lib/format';
import { approxHectares, polygonFromPoints, selfIntersects, type LonLat } from '../lib/geo';
import { uploadRegistryPhoto } from '../lib/photos';
import { supabase } from '../lib/supabase';
import type { Farmer, FarmMap as Farm, TenureType } from '../lib/types';
import { useAsync } from '../lib/useAsync';

/** A GPS fix less precise than this is too rough to mark a farm corner. */
const MAX_GPS_ACCURACY_M = 20;

export function MapFarmPage() {
  const { id: farmerId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [points, setPoints] = useState<LonLat[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [details, setDetails] = useState({
    name: '',
    primary_crop: '',
    tenure_type: 'other' as TenureType,
    soil_notes: '',
  });
  const [gps, setGps] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; clashes: OverlappingFarm[] } | null>(null);
  const [me, setMe] = useState<{ lon: number; lat: number; accuracy: number } | null>(null);

  const data = useAsync(async () => {
    const [farmer, farms] = await Promise.all([
      supabase.from('farmers').select('id, full_name').eq('id', farmerId!).maybeSingle(),
      supabase.from('farm_maps').select('*').eq('farmer_id', farmerId!),
    ]);
    if (farmer.error) throw farmer.error;
    if (farms.error) throw farms.error;
    return {
      farmer: farmer.data as Pick<Farmer, 'id' | 'full_name'> | null,
      farms: farms.data as Farm[],
    };
  }, [farmerId]);

  const addGpsPoint = () => {
    if (!navigator.geolocation) {
      setGps({ busy: false, message: 'This device cannot share its location.' });
      return;
    }
    setGps({ busy: true, message: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude, accuracy } = pos.coords;
        if (accuracy > MAX_GPS_ACCURACY_M) {
          setGps({
            busy: false,
            message: `GPS is only accurate to ${Math.round(accuracy)} m here. Wait for a better signal (under ${MAX_GPS_ACCURACY_M} m) and try again.`,
          });
          return;
        }
        setPoints((p) => [...p, [longitude, latitude]]);
        setGps({ busy: false, message: `Corner added (±${Math.round(accuracy)} m).` });
      },
      (err) => setGps({ busy: false, message: `Could not get your location: ${err.message}` }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  /** Centre the map on this device, e.g. to trace a farm around where you are. */
  const findMe = () => {
    if (!navigator.geolocation) {
      setGps({ busy: false, message: 'This device cannot share its location.' });
      return;
    }
    setGps({ busy: true, message: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe({
          lon: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
        });
        setGps({
          busy: false,
          message: `Showing your position (±${Math.round(pos.coords.accuracy)} m). Tap the corners around it.`,
        });
      },
      (err) => setGps({ busy: false, message: `Could not get your location: ${err.message}` }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const crossing = selfIntersects(points);
  const area = approxHectares(points);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const boundary = polygonFromPoints(points);
    if (!boundary || photos.length === 0) return;
    setBusy(true);
    setError(null);
    let photoPaths: string[];
    try {
      photoPaths = await Promise.all(
        photos.map((p) => uploadRegistryPhoto(profile!.id, p, 'farm')),
      );
    } catch (err) {
      setBusy(false);
      setError({ message: `Could not upload the photos: ${errorMessage(err)}`, clashes: [] });
      return;
    }
    const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
    const { error } = await supabase.rpc('map_farm', {
      p_farmer_id: farmerId,
      p_boundary: boundary,
      p_name: orNull(details.name),
      p_primary_crop: orNull(details.primary_crop),
      p_tenure_type: details.tenure_type,
      p_soil_notes: orNull(details.soil_notes),
      p_photo_paths: photoPaths,
    });
    setBusy(false);
    if (error) {
      setError({ message: errorMessage(error), clashes: overlappingFarms(error) });
      return;
    }
    navigate(`/farmers/${farmerId}`);
  };

  if (data.loading && (!data.data || data.stale)) return <PageSkeleton variant="detail" />;
  if (data.error) return <Alert>{errorMessage(data.error)}</Alert>;
  if (!data.data?.farmer) return <Alert>Farmer not found, or you don't have access.</Alert>;

  return (
    <>
      <Link to={`/farmers/${farmerId}`} className="link-back mb-2">
        ← {data.data.farmer.full_name}
      </Link>
      <PageHeader
        title="Map a farm"
        description="Walk the boundary and add a corner at each turn, or tap the corners on the satellite map. Go around in order. Then photograph the farm as it is today."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <FarmMap
            farms={data.data.farms}
            drawing={points}
            onMapClick={(p) => setPoints((prev) => [...prev, p])}
            position={me}
            focus={me}
            className="h-[28rem] w-full rounded-2xl ring-1 ring-zinc-950/5"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={findMe} disabled={gps.busy}>
              <LocateFixed className="size-4" aria-hidden /> Find me
            </Button>
            <Button type="button" onClick={addGpsPoint} busy={gps.busy}>
              <Crosshair className="size-4" aria-hidden /> Add corner at my location
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={points.length === 0}
              onClick={() => setPoints((p) => p.slice(0, -1))}
            >
              <Undo2 className="size-4" aria-hidden /> Undo
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={points.length === 0}
              onClick={() => setPoints([])}
            >
              <Trash2 className="size-4" aria-hidden /> Clear
            </Button>
          </div>
          {gps.message && <p className="text-sm text-zinc-600">{gps.message}</p>}
        </div>

        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-lg bg-zinc-50 p-3 text-sm">
              <p className="text-zinc-600">
                {points.length} corner{points.length === 1 ? '' : 's'}
                {points.length >= 3 && ` · about ${formatHectares(area)}`}
              </p>
              {points.length < 3 && (
                <p className="text-xs text-zinc-500">At least 3 corners are needed.</p>
              )}
              {crossing && (
                <p className="mt-1 text-xs text-red-700">
                  The boundary crosses itself. Undo the last corners and go around in order.
                </p>
              )}
            </div>
            <Field label="Farm name" hint="Optional, e.g. North plot">
              <Input
                value={details.name}
                onChange={(e) => setDetails({ ...details, name: e.target.value })}
                maxLength={120}
              />
            </Field>
            <Field label="Main crop">
              <Input
                value={details.primary_crop}
                onChange={(e) => setDetails({ ...details, primary_crop: e.target.value })}
                placeholder="maize"
                maxLength={60}
              />
            </Field>
            <Field label="Land tenure">
              <Select
                value={details.tenure_type}
                onChange={(e) =>
                  setDetails({ ...details, tenure_type: e.target.value as TenureType })
                }
              >
                <option value="owned">Owned</option>
                <option value="leased">Leased</option>
                <option value="communal">Communal</option>
                <option value="family">Family</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-zinc-700">Condition of the farm</p>
              <p className="text-xs text-zinc-500">
                At least one photo: the land as it is today, before the season.
              </p>
              <PhotoPicker value={photos} onChange={setPhotos} />
            </div>
            <Field label="Soil notes">
              <Textarea
                rows={3}
                value={details.soil_notes}
                onChange={(e) => setDetails({ ...details, soil_notes: e.target.value })}
                maxLength={5000}
              />
            </Field>

            {error && (
              <Alert>
                {error.message}
                {error.clashes.length > 0 && (
                  <ul className="mt-2 list-disc pl-5">
                    {error.clashes.map((c) => (
                      <li key={c.farm_id}>
                        <Link
                          to={`/farmers/${c.farmer_id}`}
                          className="font-medium underline underline-offset-2 hover:decoration-2"
                        >
                          Overlaps a registered farm by {formatHectares(c.overlap_hectares)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
            <Button
              type="submit"
              busy={busy}
              disabled={points.length < 3 || crossing || photos.length === 0}
              className="w-full"
            >
              Save farm
            </Button>
            {points.length >= 3 && !crossing && photos.length === 0 && (
              <p className="text-center text-xs text-zinc-500">
                Needs at least one photo of the farm.
              </p>
            )}
          </form>
        </Card>
      </div>
    </>
  );
}

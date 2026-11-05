import { Crosshair, Trash2, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FarmMap } from '../components/FarmMap';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { errorMessage, overlappingFarms, type OverlappingFarm } from '../lib/errors';
import { formatHectares } from '../lib/format';
import { approxHectares, polygonFromPoints, selfIntersects, type LonLat } from '../lib/geo';
import { supabase } from '../lib/supabase';
import type { Farmer, FarmMap as Farm, TenureType } from '../lib/types';
import { useAsync } from '../lib/useAsync';

/** A GPS fix less precise than this is too rough to mark a farm corner. */
const MAX_GPS_ACCURACY_M = 20;

export function MapFarmPage() {
  const { id: farmerId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [points, setPoints] = useState<LonLat[]>([]);
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

  const crossing = selfIntersects(points);
  const area = approxHectares(points);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const boundary = polygonFromPoints(points);
    if (!boundary) return;
    setBusy(true);
    setError(null);
    const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
    const { error } = await supabase.rpc('map_farm', {
      p_farmer_id: farmerId,
      p_boundary: boundary,
      p_name: orNull(details.name),
      p_primary_crop: orNull(details.primary_crop),
      p_tenure_type: details.tenure_type,
      p_soil_notes: orNull(details.soil_notes),
    });
    setBusy(false);
    if (error) {
      setError({ message: errorMessage(error), clashes: overlappingFarms(error) });
      return;
    }
    navigate(`/farmers/${farmerId}`);
  };

  if (data.loading) return <Spinner />;
  if (data.error) return <Alert>{errorMessage(data.error)}</Alert>;
  if (!data.data?.farmer) return <Alert>Farmer not found, or you don't have access.</Alert>;

  return (
    <>
      <Link
        to={`/farmers/${farmerId}`}
        className="mb-2 inline-block text-sm text-stone-500 hover:text-stone-800"
      >
        ← {data.data.farmer.full_name}
      </Link>
      <PageHeader
        title="Map a farm"
        description="Walk the boundary and add a corner at each turn, or tap the corners on the satellite map. Go around in order."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <FarmMap
            farms={data.data.farms}
            drawing={points}
            onMapClick={(p) => setPoints((prev) => [...prev, p])}
            className="h-[28rem] w-full rounded-xl border border-stone-200"
          />
          <div className="flex flex-wrap gap-2">
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
          {gps.message && <p className="text-sm text-stone-600">{gps.message}</p>}
        </div>

        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-lg bg-stone-50 p-3 text-sm">
              <p className="text-stone-600">
                {points.length} corner{points.length === 1 ? '' : 's'}
                {points.length >= 3 && ` · about ${formatHectares(area)}`}
              </p>
              {points.length < 3 && (
                <p className="text-xs text-stone-500">At least 3 corners are needed.</p>
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
                        <Link to={`/farmers/${c.farmer_id}`} className="underline">
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
              disabled={points.length < 3 || crossing}
              className="w-full"
            >
              Save farm
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

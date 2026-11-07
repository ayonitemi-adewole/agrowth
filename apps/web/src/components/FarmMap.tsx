import 'leaflet/dist/leaflet.css';
import { latLngBounds, type LatLngExpression } from 'leaflet';
import { useEffect } from 'react';
import {
  Circle,
  CircleMarker,
  LayersControl,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { formatHectares } from '../lib/format';
import { ringToLatLngs, type LonLat } from '../lib/geo';
import type { FarmMap as Farm } from '../lib/types';

/** Default view: central Nigeria. */
const NIGERIA_CENTRE: LatLngExpression = [9.08, 8.68];

interface Props {
  farms?: Farm[];
  highlightId?: string;
  /** Farms drawn in the highlight colour, e.g. those in a live cycle. */
  highlightIds?: ReadonlySet<string>;
  /** When set, the map is in drawing mode and shows these corners. */
  drawing?: LonLat[];
  onMapClick?: (point: LonLat) => void;
  /** A GPS position (the device's, or a recorded check-in), drawn with its accuracy circle. */
  position?: { lon: number; lat: number; accuracy: number } | null;
  /** Tooltip for the position. */
  positionLabel?: string;
  /** Include the position when zooming to the farms, so a check-in off the farm stays in view. */
  fitPosition?: boolean;
  /** Fly here whenever it changes (e.g. "Find me"). */
  focus?: { lon: number; lat: number } | null;
  className?: string;
}

export function FarmMap({
  farms = [],
  highlightId,
  highlightIds,
  drawing,
  onMapClick,
  position,
  positionLabel,
  fitPosition = false,
  focus,
  className,
}: Props) {
  const lit = (id: string) => id === highlightId || !!highlightIds?.has(id);
  return (
    <MapContainer
      center={NIGERIA_CENTRE}
      zoom={6}
      className={className ?? 'h-96 w-full rounded-2xl ring-1 ring-zinc-950/5'}
      scrollWheelZoom
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked={!drawing} name="Map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer checked={!!drawing} name="Satellite">
          <TileLayer
            attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      {farms.map((farm) => (
        <Polygon
          key={farm.id}
          positions={ringToLatLngs(farm.boundary)}
          pathOptions={{
            color: lit(farm.id) ? '#16a34a' : '#52525b',
            weight: lit(farm.id) ? 3 : 2,
            fillOpacity: 0.2,
          }}
        >
          <Tooltip sticky>
            {farm.name ?? 'Farm'} · {formatHectares(farm.area_hectares)}
            {farm.primary_crop ? ` · ${farm.primary_crop}` : ''}
          </Tooltip>
        </Polygon>
      ))}

      {drawing && <DrawingLayer points={drawing} />}
      {position && (
        <>
          <Circle
            center={[position.lat, position.lon]}
            radius={position.accuracy}
            pathOptions={{ color: '#0ea5e9', weight: 1, fillOpacity: 0.12 }}
          />
          <CircleMarker
            center={[position.lat, position.lon]}
            radius={7}
            pathOptions={{ color: '#fff', fillColor: '#0284c7', fillOpacity: 1, weight: 3 }}
          >
            <Tooltip>
              {positionLabel ?? 'You are here'} (±{Math.round(position.accuracy)} m)
            </Tooltip>
          </CircleMarker>
        </>
      )}
      {onMapClick && <ClickHandler onClick={onMapClick} />}
      <FitTo
        farms={farms}
        drawing={drawing}
        focus={focus}
        extra={fitPosition && position ? [position.lat, position.lon] : undefined}
      />
    </MapContainer>
  );
}

function DrawingLayer({ points }: { points: LonLat[] }) {
  const latLngs = points.map(([lon, lat]) => [lat, lon] as [number, number]);
  return (
    <>
      {latLngs.length >= 3 ? (
        <Polygon
          positions={latLngs}
          pathOptions={{ color: '#f59e0b', weight: 3, fillOpacity: 0.25 }}
        />
      ) : (
        <Polyline positions={latLngs} pathOptions={{ color: '#f59e0b', weight: 3 }} />
      )}
      {latLngs.map((p, i) => (
        <CircleMarker
          key={i}
          center={p}
          radius={5}
          pathOptions={{ color: '#fff', fillColor: '#f59e0b', fillOpacity: 1, weight: 2 }}
        />
      ))}
    </>
  );
}

function ClickHandler({ onClick }: { onClick: (p: LonLat) => void }) {
  useMapEvents({ click: (e) => onClick([e.latlng.lng, e.latlng.lat]) });
  return null;
}

/** Zooms to the farms once they load (and to the first drawn corner). */
function FitTo({
  farms,
  drawing,
  focus,
  extra,
}: {
  farms: Farm[];
  drawing?: LonLat[];
  focus?: { lon: number; lat: number } | null;
  extra?: [lat: number, lon: number];
}) {
  const map = useMap();
  const farmKey = farms.map((f) => f.id).join(',');
  const firstPoint = drawing?.[0];

  useEffect(() => {
    if (farms.length === 0) return;
    const bounds = latLngBounds(farms.flatMap((f) => ringToLatLngs(f.boundary)));
    if (extra) bounds.extend(extra);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, farmKey]);

  useEffect(() => {
    if (firstPoint && farms.length === 0) map.setView([firstPoint[1], firstPoint[0]], 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, firstPoint?.[0], firstPoint?.[1]]);

  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], 18, { duration: 0.8 });
  }, [map, focus]);

  return null;
}

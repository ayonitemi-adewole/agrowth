import 'leaflet/dist/leaflet.css';
import { latLngBounds, type LatLngExpression } from 'leaflet';
import { useEffect } from 'react';
import {
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
  /** When set, the map is in drawing mode and shows these corners. */
  drawing?: LonLat[];
  onMapClick?: (point: LonLat) => void;
  className?: string;
}

export function FarmMap({ farms = [], highlightId, drawing, onMapClick, className }: Props) {
  return (
    <MapContainer
      center={NIGERIA_CENTRE}
      zoom={6}
      className={className ?? 'h-96 w-full rounded-xl border border-stone-200'}
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
            color: farm.id === highlightId ? '#15803d' : '#78716c',
            weight: farm.id === highlightId ? 3 : 2,
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
      {onMapClick && <ClickHandler onClick={onMapClick} />}
      <FitTo farms={farms} drawing={drawing} />
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
function FitTo({ farms, drawing }: { farms: Farm[]; drawing?: LonLat[] }) {
  const map = useMap();
  const farmKey = farms.map((f) => f.id).join(',');
  const firstPoint = drawing?.[0];

  useEffect(() => {
    if (farms.length === 0) return;
    const bounds = latLngBounds(farms.flatMap((f) => ringToLatLngs(f.boundary)));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, farmKey]);

  useEffect(() => {
    if (firstPoint && farms.length === 0) map.setView([firstPoint[1], firstPoint[0]], 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, firstPoint?.[0], firstPoint?.[1]]);

  return null;
}

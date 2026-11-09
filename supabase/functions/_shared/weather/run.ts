import { WeatherError, type DailyWeather, type Normals, type WeatherProvider } from './types.ts';

export interface Cell {
  id: string;
  lat: number;
  lon: number;
  needs_normals: boolean;
}

/** How the sync reaches the database (service role); the function and the tests each supply one. */
export interface WeatherStore {
  /** Cells with farms in live cycles that are due a refresh. */
  cellsToSync(): Promise<Cell[]>;
  record(
    cellId: string,
    provider: string,
    days: DailyWeather[] | null,
    normals: Normals | null,
    error: string | null,
  ): Promise<void>;
}

/** Today in Nigeria, as YYYY-MM-DD. */
export const lagosToday = (now = new Date()) =>
  new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Refreshes the weather of every cell that's due: the last three months and the coming
 * week, and the normals for cells that don't have them yet. A cell that fails is recorded
 * with its error and tried again next time; the others carry on.
 */
export async function syncWeather(
  provider: WeatherProvider,
  store: WeatherStore,
  opts: { today?: string; maxCells?: number } = {},
) {
  const today = opts.today ?? lagosToday();
  const cells = (await store.cellsToSync()).slice(0, opts.maxCells ?? 40);
  let updated = 0;
  const failed: { lat: number; lon: number; error: string }[] = [];
  for (const cell of cells) {
    try {
      const days = await provider.recent(cell.lat, cell.lon, today);
      const normals = cell.needs_normals ? await provider.normals(cell.lat, cell.lon, today) : null;
      await store.record(cell.id, provider.name, days, normals, null);
      updated++;
    } catch (err) {
      const error = err instanceof WeatherError ? err.message : 'The weather provider failed';
      failed.push({ lat: cell.lat, lon: cell.lon, error });
      await store.record(cell.id, provider.name, null, null, error);
    }
  }
  return { cells: cells.length, updated, failed };
}

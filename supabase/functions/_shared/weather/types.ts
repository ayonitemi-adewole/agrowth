/**
 * Weather per farm: daily rainfall and temperatures for each weather cell (a 0.1° grid
 * square, about 11 km, shared by the farms in it), and the cell's normal rainfall for each
 * day of the year.
 *
 * Plain TypeScript (fetch only), shared by the weather-sync Edge Function and the tests.
 */

export interface DailyWeather {
  /** YYYY-MM-DD, in Nigerian time. */
  day: string;
  rain_mm: number | null;
  tmax_c: number | null;
  tmin_c: number | null;
  /** A forecast (today onwards) rather than an observation. */
  forecast: boolean;
}

/** Normal daily rainfall, in mm, by "MM-DD"; and how many years it's averaged over. */
export interface Normals {
  rain_mm: Record<string, number>;
  years: number;
}

export interface WeatherProvider {
  readonly name: string;
  /** The recent past (about three months) and the coming week. */
  recent(lat: number, lon: number, today: string): Promise<DailyWeather[]>;
  /** Average rainfall for each day of the year, over past full years. */
  normals(lat: number, lon: number, today: string): Promise<Normals>;
}

export class WeatherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherError';
  }
}

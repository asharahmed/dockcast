/**
 * `docs/api.md` §2 — GET /cities.
 */
import { z } from 'zod';

export const citySchema = z.object({
  slug: z.string(),
  name: z.string(),
  tz: z.string(),
  lat: z.number(),
  lon: z.number(),
  forecasting_enabled: z.boolean(),
  station_count: z.number().int().nonnegative(),
  last_status_ok_at: z.string().datetime({ offset: true }).nullable(),
});
export type City = z.infer<typeof citySchema>;

export const cityListResponseSchema = z.object({
  cities: z.array(citySchema),
});
export type CityListResponse = z.infer<typeof cityListResponseSchema>;

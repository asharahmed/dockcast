/**
 * Geo helpers. `docs/api.md` §0.1.
 */
import { RIDE_KMH, RIDE_OVERHEAD_MIN } from './constants.js';

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in kilometres (haversine formula). */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * Default ride time estimate between two points, in whole minutes.
 * `docs/api.md` §0.1: `max(5, round(haversine_km(origin,dest) / RIDE_KMH · 60 + RIDE_OVERHEAD_MIN))`.
 */
export function rideMinutesDefault(a: LatLon, b: LatLon): number {
  const km = haversineKm(a, b);
  const minutes = Math.round((km / RIDE_KMH) * 60 + RIDE_OVERHEAD_MIN);
  return Math.max(5, minutes);
}

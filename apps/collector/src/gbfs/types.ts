/**
 * Types shared by the GBFS adapter (`docs/collector-spec.md` §2) and the
 * collection cycles that consume normalised rows (`status.ts`, `information.ts`).
 */

/** Thrown by `normalise*()` when the parsed JSON is missing required structure. */
export class GbfsSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GbfsSchemaError';
  }
}

/** `station_information` row after version-specific normalisation (collector-spec.md §2.2). */
export interface NormalizedStationInfo {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number | null;
}

/** `station_status` row after version-specific normalisation (collector-spec.md §2.3). */
export interface NormalizedStationStatus {
  station_id: string;
  bikes: number;
  docks: number;
  ebikes: number | null;
  bikes_disabled: number | null;
  docks_disabled: number | null;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  last_reported: Date;
}

/** Result of GBFS auto-discovery (collector-spec.md §2.1): `name -> url`. */
export interface FeedMap {
  version: string;
  feeds: Map<string, string>;
}

/** `vehicle_type_id -> propulsion_type` (collector-spec.md §2.3.1). */
export type VehicleTypeMap = Map<string, string>;

/**
 * The subset of a `NormalizedStationStatus` used for change detection
 * (collector-spec.md §3.3 step 4); `last_reported` as epoch ms so every field
 * (including this one) can be compared with `===`.
 */
export interface LastState {
  bikes: number;
  docks: number;
  ebikes: number | null;
  bikes_disabled: number | null;
  docks_disabled: number | null;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  last_reported: number;
}

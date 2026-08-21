/**
 * TanStack Query hooks + query keys. ui-spec.md §3.
 *
 * WP-9 implements the hooks needed by the map/station pages, auth pages and
 * shell (cities, stations, map, station detail/history, health, auth). WP-10
 * adds the remaining rows of the §3 table (`useTrip`, `useModel*`,
 * `useCommutes*`, push hooks) alongside the pages that consume them.
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from './client.js';
import { schemas } from './types.js';
import type {
  CityListResponse,
  StationListResponse,
  MapResponse,
  StationDetailResponse,
  StationHistoryResponse,
  UserResponse,
  AuthProvidersResponse,
  AuthIdentitiesResponse,
  HealthResponse,
  LoginRequest,
  RegisterRequest,
  TripResponse,
  ModelResponse,
  ModelVersionDetailResponse,
  Commute,
  CommuteListResponse,
  CommuteCreateRequest,
  CommuteCreateResponse,
  CommuteUpdateRequest,
  CommuteUpdateResponse,
  VapidKeyResponse,
  PushSubscribeRequest,
  PushSubscribeResponse,
  PushUnsubscribeRequest,
  PushTestResponse,
} from './types.js';

export const queryKeys = {
  cities: ['cities'] as const,
  stations: (slug: string) => ['stations', slug] as const,
  map: (slug: string) => ['map', slug] as const,
  station: (id: number) => ['station', id] as const,
  stationHistory: (id: number, hours: number) => ['station-history', id, hours] as const,
  me: ['me'] as const,
  authProviders: ['auth-providers'] as const,
  authIdentities: ['auth-identities'] as const,
  health: ['health'] as const,
  trip: (origin: number, dest: number, departAtMinute: number | null, rideMinutes: number | null) =>
    ['trip', origin, dest, departAtMinute, rideMinutes] as const,
  model: (slug: string) => ['model', slug] as const,
  modelVersion: (id: number) => ['model-version', id] as const,
  commutes: ['commutes'] as const,
  vapid: ['vapid'] as const,
};

export function useCities() {
  return useQuery({
    queryKey: queryKeys.cities,
    queryFn: () => apiGet<CityListResponse>('/cities', schemas.cityListResponse),
    staleTime: 5 * 60_000,
  });
}

export function useStations(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.stations(slug ?? ''),
    queryFn: () =>
      apiGet<StationListResponse>(
        `/cities/${encodeURIComponent(slug ?? '')}/stations`,
        schemas.stationListResponse,
      ),
    enabled: !!slug,
    staleTime: 60 * 60_000,
  });
}

export function useMap(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.map(slug ?? ''),
    queryFn: () =>
      apiGet<MapResponse>(
        `/cities/${encodeURIComponent(slug ?? '')}/map`,
        schemas.mapResponse,
      ),
    enabled: !!slug,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useStation(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.station(id ?? -1),
    queryFn: () => apiGet<StationDetailResponse>(`/stations/${id}`, schemas.stationDetailResponse),
    enabled: id !== undefined,
    refetchInterval: 30_000,
  });
}

export function useStationHistory(id: number | undefined, hours: number) {
  return useQuery({
    queryKey: queryKeys.stationHistory(id ?? -1, hours),
    queryFn: () =>
      apiGet<StationHistoryResponse>(
        `/stations/${id}/history?hours=${hours}`,
        schemas.stationHistoryResponse,
      ),
    enabled: id !== undefined,
    refetchInterval: 60_000,
  });
}

/** `GET /auth/me` — a 401 resolves to `null` rather than an error state. ui-spec.md §3. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        return await apiGet<UserResponse>('/auth/me', schemas.userResponse);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
  });
}

/** `GET /auth/providers` — which OAuth buttons to show; config-derived, so cached hard. */
export function useAuthProviders() {
  return useQuery({
    queryKey: queryKeys.authProviders,
    queryFn: () => apiGet<AuthProvidersResponse>('/auth/providers', schemas.authProvidersResponse),
    staleTime: Infinity,
  });
}

/** `GET /auth/identities` — the signed-in user's sign-in methods (Account page). */
export function useAuthIdentities() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: queryKeys.authIdentities,
    queryFn: () => apiGet<AuthIdentitiesResponse>('/auth/identities', schemas.authIdentitiesResponse),
    enabled: !!me,
  });
}

export function useUnlinkIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: 'google' | 'apple') => apiDelete<undefined>(`/auth/identities/${provider}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.authIdentities });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      apiPost<UserResponse>('/auth/login', body, schemas.userResponse),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['commutes'] });
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) =>
      apiPost<UserResponse>('/auth/register', body, schemas.userResponse),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['commutes'] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<undefined>('/auth/logout'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['commutes'] });
    },
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiGet<HealthResponse>('/health', schemas.healthResponse),
    refetchInterval: 60_000,
  });
}

/**
 * `GET /trip`. ui-spec.md §3, §4.1 `TripPlanner`/`TripResult`.
 * `departAt` is truncated to the minute so the query key is stable across
 * re-renders within the same minute; `enabled` additionally gates on
 * `origin`/`dest` both being present (ui-spec.md: "auto-refresh via `useTrip`
 * 60 s while result is shown" — callers pass `enabled` for that "shown" gate).
 */
export interface UseTripParams {
  origin: number | undefined;
  dest: number | undefined;
  departAt?: Date;
  rideMinutes?: number;
  enabled?: boolean;
}

export function useTrip({ origin, dest, departAt, rideMinutes, enabled = true }: UseTripParams) {
  const departAtMinute = departAt ? Math.floor(departAt.getTime() / 60_000) * 60_000 : null;
  return useQuery({
    queryKey: queryKeys.trip(origin ?? -1, dest ?? -1, departAtMinute, rideMinutes ?? null),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('origin', String(origin));
      params.set('dest', String(dest));
      if (departAtMinute !== null) params.set('depart_at', new Date(departAtMinute).toISOString());
      if (rideMinutes !== undefined) params.set('ride_minutes', String(rideMinutes));
      return apiGet<TripResponse>(`/trip?${params.toString()}`, schemas.tripResponse);
    },
    enabled: enabled && origin !== undefined && dest !== undefined,
    refetchInterval: 60_000,
  });
}

export function useModel(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.model(slug ?? ''),
    queryFn: () =>
      apiGet<ModelResponse>(`/model?city=${encodeURIComponent(slug ?? '')}`, schemas.modelResponse),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });
}

export function useModelVersion(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.modelVersion(id ?? -1),
    queryFn: () =>
      apiGet<ModelVersionDetailResponse>(
        `/model/versions/${id}`,
        schemas.modelVersionDetailResponse,
      ),
    enabled: id !== undefined,
  });
}

/** `GET /commutes` (auth required). `enabled: !!me` per ui-spec.md §3. */
export function useCommutes() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: queryKeys.commutes,
    queryFn: () => apiGet<CommuteListResponse>('/commutes', schemas.commuteListResponse),
    enabled: !!me,
    refetchInterval: 60_000,
  });
}

/** Applies the subset of `CommuteUpdateRequest` fields whose shape matches `Commute` 1:1 (excludes `origin_station_id`/`dest_station_id`, which need denormalising into `StationRef` — those refresh via the `onSettled` invalidate instead). */
function applyOptimisticUpdate<T extends Commute>(commute: T, body: CommuteUpdateRequest): T {
  return {
    ...commute,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.depart_local_time !== undefined ? { depart_local_time: body.depart_local_time } : {}),
    ...(body.ride_minutes !== undefined ? { ride_minutes: body.ride_minutes } : {}),
    ...(body.days_of_week !== undefined ? { days_of_week: body.days_of_week } : {}),
    ...(body.alert_enabled !== undefined ? { alert_enabled: body.alert_enabled } : {}),
    ...(body.alert_lead_minutes !== undefined
      ? { alert_lead_minutes: body.alert_lead_minutes }
      : {}),
    ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
  };
}

export function useCreateCommute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CommuteCreateRequest) =>
      apiPost<CommuteCreateResponse>('/commutes', body, schemas.commuteCreateResponse),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.commutes });
    },
  });
}

export interface UpdateCommuteVars {
  id: string;
  body: CommuteUpdateRequest;
}

export function useUpdateCommute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateCommuteVars) =>
      apiPatch<CommuteUpdateResponse>(`/commutes/${id}`, body, schemas.commuteUpdateResponse),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.commutes });
      const previous = queryClient.getQueryData<CommuteListResponse>(queryKeys.commutes);
      if (previous) {
        queryClient.setQueryData<CommuteListResponse>(queryKeys.commutes, {
          commutes: previous.commutes.map((c) =>
            c.id === id ? applyOptimisticUpdate(c, body) : c,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.commutes, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.commutes });
    },
  });
}

export function useDeleteCommute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<undefined>(`/commutes/${id}`),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.commutes });
      const previous = queryClient.getQueryData<CommuteListResponse>(queryKeys.commutes);
      if (previous) {
        queryClient.setQueryData<CommuteListResponse>(queryKeys.commutes, {
          commutes: previous.commutes.filter((c) => c.id !== id),
        });
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.commutes, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.commutes });
    },
  });
}

/** `GET /push/vapid-public-key` (public). `staleTime: Infinity` per ui-spec.md §3. */
export function useVapidKey() {
  return useQuery({
    queryKey: queryKeys.vapid,
    queryFn: () => apiGet<VapidKeyResponse>('/push/vapid-public-key', schemas.vapidKeyResponse),
    staleTime: Infinity,
  });
}

export function useSubscribePush() {
  return useMutation({
    mutationFn: (body: PushSubscribeRequest) =>
      apiPost<PushSubscribeResponse>('/push/subscriptions', body, schemas.pushSubscribeResponse),
  });
}

export function useUnsubscribePush() {
  return useMutation({
    mutationFn: (body: PushUnsubscribeRequest) =>
      apiDelete<undefined>('/push/subscriptions', body),
  });
}

export function useTestPush() {
  return useMutation({
    mutationFn: () => apiPost<PushTestResponse>('/push/test', undefined, schemas.pushTestResponse),
  });
}

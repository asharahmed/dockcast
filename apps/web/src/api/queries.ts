/**
 * TanStack Query hooks + query keys. ui-spec.md §3.
 *
 * WP-9 implements the hooks needed by the map/station pages, auth pages and
 * shell (cities, stations, map, station detail/history, health, auth). The
 * remaining rows of the §3 table (`useTrip`, `useModel*`, `useCommutes*`,
 * push hooks) land in WP-10 alongside the pages that consume them.
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiGet, apiPost, ApiError } from './client.js';
import { schemas } from './types.js';
import type {
  CityListResponse,
  StationListResponse,
  MapResponse,
  StationDetailResponse,
  StationHistoryResponse,
  UserResponse,
  HealthResponse,
  LoginRequest,
  RegisterRequest,
} from './types.js';

export const queryKeys = {
  cities: ['cities'] as const,
  stations: (slug: string) => ['stations', slug] as const,
  map: (slug: string) => ['map', slug] as const,
  station: (id: number) => ['station', id] as const,
  stationHistory: (id: number, hours: number) => ['station-history', id, hours] as const,
  me: ['me'] as const,
  health: ['health'] as const,
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

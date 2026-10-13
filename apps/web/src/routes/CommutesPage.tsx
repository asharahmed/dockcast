/**
 * `/commutes` (auth). ui-spec.md §4.4.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  useCommutes,
  useCreateCommute,
  useUpdateCommute,
  useDeleteCommute,
  useCities,
  useStations,
  useMap,
} from '../api/queries.js';
import { useCity } from '../hooks/useCity.js';
import { useNow } from '../hooks/useNow.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shell/Toasts.js';
import { ApiError } from '../api/client.js';
import {
  CommuteForm,
  COMMUTE_FORM_DEFAULTS,
  type CommuteFormInitial,
} from '../components/commutes/CommuteForm.js';
import { CommuteList } from '../components/commutes/CommuteList.js';
import { PushSetup } from '../components/commutes/PushSetup.js';
import { Button } from '../components/ui/Button.js';
import { Icon } from '../components/ui/Icon.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { COPY } from '../lib/constants.js';
import type { CommuteWithOutlook, CommuteCreateRequest } from '../api/types.js';

function buildPrefillFromUrl(searchParams: URLSearchParams): CommuteFormInitial | undefined {
  if (searchParams.get('new') !== '1') return undefined;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const at = searchParams.get('at');
  const ride = searchParams.get('ride');
  return {
    ...COMMUTE_FORM_DEFAULTS,
    originId: from ? Number(from) : null,
    destId: to ? Number(to) : null,
    departLocalTime: at ?? '',
    rideMinutes: ride ? Number(ride) : null,
  };
}

export default function CommutesPage() {
  useDocumentTitle('My commutes · DockCast');
  const now = useNow();
  const [searchParams, setSearchParams] = useSearchParams();
  const commutesQuery = useCommutes();
  const createMutation = useCreateCommute();
  const updateMutation = useUpdateCommute();
  const deleteMutation = useDeleteCommute();
  const addToast = useToast();

  const { data: citiesData } = useCities();
  const cities = citiesData?.cities ?? [];
  const [slug] = useCity(cities[0]?.slug);
  const city = cities.find((c) => c.slug === slug) ?? cities[0];
  const stationsQuery = useStations(city?.slug);
  const mapQuery = useMap(city?.slug);
  const stations = stationsQuery.data?.stations ?? [];
  const mapStations = mapQuery.data?.stations ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CommuteWithOutlook | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(null);
      setFormOpen(true);
    }
    // Only react to the initial deep link, not every param change — intentionally `[]`.
  }, []);

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setFormError(null);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete('new');
        params.delete('from');
        params.delete('to');
        params.delete('at');
        params.delete('ride');
        return params;
      },
      { replace: true },
    );
  }

  function openNew() {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(commute: CommuteWithOutlook) {
    setEditing(commute);
    setFormError(null);
    setFormOpen(true);
  }

  function onSaved(id: string) {
    addToast(COPY.commutes.form.savedToast, 'good');
    setHighlightedId(id);
    closeForm();
    window.setTimeout(() => setHighlightedId(null), 1200);
  }

  function handleSubmit(body: CommuteCreateRequest) {
    setFormError(null);
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, body },
        {
          onSuccess: (res) => onSaved(res.commute.id),
          onError: (err) => setFormError(err instanceof ApiError ? err.message : COPY.errors.generic),
        },
      );
    } else {
      createMutation.mutate(body, {
        onSuccess: (res) => onSaved(res.commute.id),
        onError: (err) => setFormError(err instanceof ApiError ? err.message : COPY.errors.generic),
      });
    }
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id);
  }

  const commutes = commutesQuery.data?.commutes ?? [];

  const initialForForm: CommuteFormInitial | undefined = editing
    ? {
        name: editing.name,
        originId: editing.origin.id,
        destId: editing.dest.id,
        departLocalTime: editing.depart_local_time,
        rideMinutes: editing.ride_minutes,
        daysOfWeek: editing.days_of_week,
        alertEnabled: editing.alert_enabled,
        alertLeadMinutes: editing.alert_lead_minutes,
        threshold: editing.threshold,
      }
    : buildPrefillFromUrl(searchParams);

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-[var(--sp-6)] px-[var(--gutter)] py-[var(--sp-8)] pb-24 md:pb-[var(--sp-8)]">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.commutes.title}</h1>
        <div className="hidden sm:block">
          <Button type="button" icon="plus" onClick={openNew}>
            {COPY.commutes.newCommute}
          </Button>
        </div>
      </div>

      <PushSetup />

      {formOpen && (
        <CommuteForm
          stations={stations}
          mapStations={mapStations}
          mode={editing ? 'edit' : 'create'}
          initial={initialForForm}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          submitting={createMutation.isPending || updateMutation.isPending}
          serverError={formError}
        />
      )}

      {commutesQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton height={80} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </div>
      ) : commutesQuery.isError ? (
        <EmptyState
          icon="alert"
          title={COPY.commutes.couldntLoad}
          action={{ label: COPY.map.retry, onClick: () => commutesQuery.refetch() }}
        />
      ) : (
        <CommuteList
          commutes={commutes}
          now={now}
          highlightedId={highlightedId}
          onNew={openNew}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      )}

      {/* Phone "new commute" button; hidden while the form is open, which it would cover. */}
      {!formOpen && (
        <button
          type="button"
          onClick={openNew}
          aria-label={COPY.commutes.newCommute}
          className="fixed bottom-[calc(var(--tabbar-h)+var(--sp-4))] right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-signal text-signal-ink sm:hidden"
          style={{ boxShadow: 'var(--shadow-panel)' }}
        >
          <Icon name="plus" size={24} />
        </button>
      )}
    </div>
  );
}

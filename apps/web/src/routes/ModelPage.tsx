/**
 * `/model` — model quality page. ui-spec.md §4.5. The api decides which view this is
 * (docs/api.md §4): `viewer.is_admin` gets the operator view with every tier and the
 * version history; everyone else gets the public view that explains the serving model.
 */
import { useCities, useModel } from '../api/queries.js';
import { useCity } from '../hooks/useCity.js';
import { useNow } from '../hooks/useNow.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { DetailedModelView } from '../components/model/DetailedModelView.js';
import { PublicModelView } from '../components/model/PublicModelView.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { COPY } from '../lib/constants.js';
import { REPO_URL } from '../lib/site.js';


export default function ModelPage() {
  useDocumentTitle('Model quality · DockCast');
  const now = useNow();
  const { data: citiesData } = useCities();
  const cities = citiesData?.cities ?? [];
  const [slug] = useCity(cities[0]?.slug);
  const city = cities.find((c) => c.slug === slug) ?? cities[0];
  const modelQuery = useModel(city?.slug);

  if (modelQuery.isLoading || !modelQuery.data) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8 px-[var(--gutter)] py-[var(--sp-8)]">
        <Skeleton height={40} width={320} />
        <Skeleton height={120} />
        <Skeleton height={300} />
      </div>
    );
  }

  if (modelQuery.isError) {
    return (
      <div className="mx-auto max-w-[1100px] px-[var(--gutter)] py-[var(--sp-8)]">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.model.title}</h1>
        <EmptyState
          icon="alert"
          title={COPY.model.couldntLoad}
          action={{ label: COPY.map.retry, onClick: () => modelQuery.refetch() }}
        />
      </div>
    );
  }

  const model = modelQuery.data;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-[var(--sp-8)] px-[var(--gutter)] py-[var(--sp-8)]">
      <div className="flex max-w-[68ch] flex-col gap-3">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.model.title}</h1>
        <p className="text-ink-2">{COPY.model.intro}</p>
      </div>

      {model.viewer.is_admin ? (
        <DetailedModelView model={model} now={now} />
      ) : (
        <PublicModelView model={model} now={now} />
      )}

      <p className="max-w-[68ch] text-[length:var(--fs-sm)] text-ink-3">
        {COPY.model.footnote}{' '}
        {REPO_URL ? (
          <a
            href={`${REPO_URL}/blob/main/docs/ml-spec.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-signal underline underline-offset-4"
          >
            {COPY.model.footnoteLinkLabel}
          </a>
        ) : (
          <span>{COPY.model.footnoteLinkLabel}</span>
        )}
      </p>
    </div>
  );
}

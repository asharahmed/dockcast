/**
 * 404 heading + a station-page variant (`useStation` 404). ui-spec.md §4.0, §4.2.
 */
import { Link } from 'react-router';
import { COPY } from '../../lib/constants.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';

export interface NotFoundProps {
  title?: string;
  body?: string;
  linkTo?: string;
  linkLabel?: string;
  documentTitle?: string;
}

export function NotFound({
  title = COPY.notFound.title,
  body = COPY.notFound.body,
  linkTo = '/',
  linkLabel = COPY.notFound.link,
  documentTitle = 'Not found · DockCast',
}: NotFoundProps) {
  useDocumentTitle(documentTitle);

  return (
    <div className="mx-auto flex max-w-[68ch] flex-col gap-4 px-[var(--gutter)] py-[var(--sp-8)]">
      <h1 className="text-[length:var(--fs-2xl)]">{title}</h1>
      {body && <p className="text-ink-2">{body}</p>}
      <Link to={linkTo} className="text-signal underline underline-offset-4">
        {linkLabel}
      </Link>
    </div>
  );
}

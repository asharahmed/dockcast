/**
 * WCAG table twin for a chart. ui-spec.md §2.5, §5 (component contract lists
 * this under `components/model/`, but every chart on every page needs one —
 * kept here in `ui/` as the one shared implementation; WP-10's model charts
 * should import it from here rather than duplicating it).
 */
import { useState } from 'react';

export interface ChartTableColumn {
  key: string;
  label: string;
  format?: (value: unknown) => string;
}

export interface ChartTableProps {
  columns: ChartTableColumn[];
  rows: Record<string, unknown>[];
  caption: string;
}

export function ChartTable({ columns, rows, caption }: ChartTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[length:var(--fs-sm)]">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr className="border-b border-rule text-ink-3">
            {columns.map((col) => (
              <th key={col.key} className="py-2 pr-3 font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-rule">
              {columns.map((col) => (
                <td key={col.key} className="py-2 pr-3 tabular-nums">
                  {col.format ? col.format(row[col.key]) : String(row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function useChartTableToggle(): [boolean, () => void] {
  const [showTable, setShowTable] = useState(false);
  return [showTable, () => setShowTable((v) => !v)];
}

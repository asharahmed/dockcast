/**
 * Custom chart legend: swatch + label, under the chart title. ui-spec.md §2.5
 * ("custom `<ChartLegend>` under the chart title... single series → no
 * legend, the title names it").
 */
export interface ChartLegendItem {
  label: string;
  color: string;
  /** `'line'` (default) or `'swatch'` for a filled band/area entry. */
  shape?: 'line' | 'swatch';
  dashed?: boolean;
}

export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  if (items.length < 2) return null;

  return (
    <ul className="flex flex-wrap gap-4">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
          {item.shape === 'swatch' ? (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-4 rounded-[2px]"
              style={{ background: item.color }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{
                background: item.dashed ? 'transparent' : item.color,
                borderTop: item.dashed ? `2px dashed ${item.color}` : undefined,
              }}
            />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

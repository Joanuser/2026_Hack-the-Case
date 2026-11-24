import type { ReactNode } from 'react';
import { SortBoth } from '../ui/icons';
import type { Sort, SortKey } from '../lib/model';

export interface Column<T> {
  key: string;
  label: string;
  sortKey?: SortKey;
  width: string; // CSS grid track
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  sort,
  onSort,
  selectedId,
  onSelect,
  marker,
  rowClass,
  empty,
  testId,
}: {
  columns: Column<T>[];
  rows: T[];
  sort: Sort;
  onSort: (k: SortKey) => void;
  selectedId: string | null;
  onSelect: (row: T) => void;
  marker: (row: T) => 'urgent' | 'overdue' | null;
  rowClass?: (row: T) => string;
  empty: ReactNode;
  testId?: string;
}) {
  const template = ['4px', ...columns.map((c) => c.width)].join(' ');
  return (
    <div className="table" role="table" data-testid={testId}>
      <div className="thead" role="row" style={{ gridTemplateColumns: template }}>
        <span aria-hidden />
        {columns.map((c) =>
          c.sortKey ? (
            <button
              key={c.key}
              type="button"
              role="columnheader"
              className={`th sortable ${sort.key === c.sortKey ? 'active' : ''}`}
              aria-sort={sort.key === c.sortKey ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              onClick={() => onSort(c.sortKey!)}
            >
              <span>{c.label}</span>
              <SortBoth dir={sort.key === c.sortKey ? sort.dir : null} />
            </button>
          ) : (
            <span key={c.key} role="columnheader" className="th">{c.label}</span>
          ),
        )}
      </div>
      <div className="tbody">
        {rows.length === 0 && <div className="empty-row">{empty}</div>}
        {rows.map((r) => {
          const m = marker(r);
          return (
            <div
              key={r.id}
              role="row"
              tabIndex={0}
              aria-selected={selectedId === r.id}
              className={`tr ${selectedId === r.id ? 'selected' : ''} ${rowClass?.(r) ?? ''}`}
              style={{ gridTemplateColumns: template }}
              onClick={() => onSelect(r)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r); } }}
              data-number={(r as unknown as { waitingNumber?: string }).waitingNumber}
            >
              <span className={`marker ${m ?? ''}`} aria-label={m === 'urgent' ? 'Symptoms changed' : m === 'overdue' ? 'Actual W2 reached 60 minutes' : undefined} />
              {columns.map((c) => (
                <div key={c.key} role="cell" className={`td ${c.className ?? ''}`}>{c.render(r)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

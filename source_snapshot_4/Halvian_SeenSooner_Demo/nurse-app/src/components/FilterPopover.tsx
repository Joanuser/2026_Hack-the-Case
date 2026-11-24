import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Filter } from '../ui/icons';
import { SOURCE_LABEL, STATUS_LABEL, WAIT_RANGE_LABEL, type Filters, type View } from '../lib/model';
import type { CheckInSource, PatientStatus } from '../api';

function Select<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; testId?: string }) {
  return (
    <label className="f-select">
      <span className="f-label">{label}</span>
      <span className="f-control">
        <select value={value} onChange={(e) => onChange(e.target.value as T)} data-testid={testId}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <ChevronDown size={14} />
      </span>
    </label>
  );
}

export function FilterPopover({ view, filters, onChange, onReset }: { view: View; filters: Filters; onChange: (f: Filters) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const methods: [('all' | CheckInSource), string][] = [['all', 'All methods'], ...(Object.entries(SOURCE_LABEL) as [CheckInSource, string][])
    .filter(([k]) => view !== 'followup' || k !== 'mobile')];
  const waits = Object.entries(WAIT_RANGE_LABEL) as [Filters['wait'], string][];

  return (
    <div className="filter-wrap" ref={ref}>
      <button type="button" className="set-filters" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="set-filters">
        <Filter size={16} /> Set filters
      </button>
      {open && (
        <div className="filter-pop" role="dialog" aria-label="Filters">
          <p className="f-title">{view === 'followup' ? 'FOLLOW-UP FILTERS' : 'FILTERS'}</p>
          <div className="f-grid">
            <Select label="CHECK-IN METHOD" value={filters.method} options={methods} onChange={(method) => onChange({ ...filters, method })} testId="filter-method" />
            <Select label="WAIT TIME" value={filters.wait} options={waits} onChange={(wait) => onChange({ ...filters, wait })} testId="filter-wait" />
            {view === 'followup' && (
              <Select label="FOLLOW-UP STATUS" value={filters.followUp} options={[['needs', 'Needs an update'], ['checked', 'Checked recently'], ['all', 'All']]} onChange={(followUp) => onChange({ ...filters, followUp })} testId="filter-followup" />
            )}
            {view === 'completed' && (
              <Select
                label="STATUS"
                value={filters.status}
                options={[['all', 'All statuses'], ...(['waiting_provider', 'with_care_team', 'inactive', 'completed', 'left'] as PatientStatus[]).map((s) => [s, STATUS_LABEL[s]] as [PatientStatus, string])]}
                onChange={(status) => onChange({ ...filters, status })}
                testId="filter-status"
              />
            )}
            {view === 'assessment' && (
              <label className="f-check">
                <input type="checkbox" checked={filters.changedOnly} onChange={(e) => onChange({ ...filters, changedOnly: e.target.checked })} />
                Symptom changes only
              </label>
            )}
          </div>
          <div className="f-actions">
            <button type="button" className="link" onClick={onReset}>Reset</button>
            <button type="button" className="btn-sm primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

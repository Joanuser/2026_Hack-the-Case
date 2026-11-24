import { useApp } from '../context';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Value format matches the typed field: "MM / DD / YYYY" (blank parts while incomplete, '' when untouched). */
function parse(v: string): [string, string, string] {
  const [m = '', d = '', y = ''] = v.split('/').map((s) => s.trim());
  return [m, d, y];
}

/** Birth date as three dropdowns (month, day, year): no typing or slashes needed. */
export function DobSelect({ id, value, onChange, invalid, describedBy }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  const { t } = useApp();
  const [m, d, y] = parse(value);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 121 }, (_, i) => String(thisYear - i));
  const daysIn = m ? new Date(Number(y) || 2000, Number(m), 0).getDate() : 31;
  const set = (nm: string, nd: string, ny: string) => {
    if (nd && nm && Number(nd) > new Date(Number(ny) || 2000, Number(nm), 0).getDate()) nd = '';
    onChange(nm || nd || ny ? `${nm} / ${nd} / ${ny}` : '');
  };
  const common = { 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy };
  return (
    <div className="dob-select">
      <select id={id} className={`input sel ${m ? '' : 'placeholder'}`} value={m} aria-label={t.dobMonth} onChange={(e) => set(e.target.value, d, y)} {...common} data-testid="dob-month">
        <option value="">{t.dobMonth}</option>
        {MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)}
      </select>
      <select className={`input sel ${d ? '' : 'placeholder'}`} value={d} aria-label={t.dobDay} onChange={(e) => set(m, e.target.value, y)} {...common} data-testid="dob-day">
        <option value="">{t.dobDay}</option>
        {Array.from({ length: daysIn }, (_, i) => String(i + 1).padStart(2, '0')).map((v) => <option key={v} value={v}>{Number(v)}</option>)}
      </select>
      <select className={`input sel ${y ? '' : 'placeholder'}`} value={y} aria-label={t.dobYear} onChange={(e) => set(m, d, e.target.value)} {...common} data-testid="dob-year">
        <option value="">{t.dobYear}</option>
        {years.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
}

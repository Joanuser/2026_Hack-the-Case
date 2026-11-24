import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError, type StaffCreatePatientRequest, type StaffPatient } from '../api';
import { Close } from '../ui/icons';
import { LANGUAGE_LABEL } from '../lib/model';

type Source = StaffCreatePatientRequest['source'];

const empty = { source: 'front_desk' as Source, legalName: '', dateOfBirth: '', language: 'en', zone: '', seat: '', mainConcern: '', pain: '', insurance: '', phone: '' };

/** Registers a patient who did not use the phone flow (front desk, iPad, staff-assisted, walk-in). */
export function AddPatientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: StaffPatient) => void }) {
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [netErr, setNetErr] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select, input')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const set = (k: keyof typeof empty, v: string) => { setF({ ...f, [k]: v }); setErrors({ ...errors, [k]: '' }); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.legalName.trim()) errs.legalName = 'Required';
    if (!f.dateOfBirth) errs.dateOfBirth = 'Required';
    else if (Date.parse(f.dateOfBirth) > Date.now()) errs.dateOfBirth = 'Can’t be in the future';
    if (!f.mainConcern.trim()) errs.mainConcern = 'Required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setNetErr(null);
    try {
      const p = await api.createStaffPatient({
        source: f.source,
        legalName: f.legalName.trim(),
        dateOfBirth: f.dateOfBirth,
        language: f.language,
        phone: f.phone.trim(),
        insurance: f.insurance.trim(),
        location: f.zone || f.seat ? { zone: f.zone.trim(), seat: f.seat.trim() } : null,
        symptoms: { mainConcern: f.mainConcern.trim(), painLevel: f.pain === '' ? null : Number(f.pain) },
      });
      onCreated(p);
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k]) => [k, 'Check this field'])));
      setNetErr(err instanceof ApiRequestError && err.isNetwork ? 'Can’t reach the server. Check the connection and try again.' : 'Could not add the patient. Check the form and try again.');
      setBusy(false);
    }
  };

  const err = (k: string) => (errors[k] ? <span className="err">{errors[k]}</span> : null);

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onSubmit={submit} noValidate data-testid="add-patient-modal">
        <div className="modal-head">
          <div>
            <h2 id="add-title">Add in-person check-in</h2>
            <p className="muted">For patients checking in at the front desk, on the iPad, or with staff help. They receive a waiting number and appear on the waiting-room display.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Close /></button>
        </div>
        <div className="form-grid">
          <label className="lbl">Check-in method
            <select className="inp" value={f.source} onChange={(e) => set('source', e.target.value)}>
              <option value="front_desk">Front desk check-in</option>
              <option value="ipad">iPad check-in</option>
              <option value="staff_assisted">Staff-assisted</option>
              <option value="walk_in">Walk-in registration</option>
            </select>
          </label>
          <label className="lbl">Language
            <select className="inp" value={f.language} onChange={(e) => set('language', e.target.value)}>
              {Object.entries(LANGUAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="lbl span2">Legal name *
            <input className={`inp ${errors.legalName ? 'invalid' : ''}`} value={f.legalName} onChange={(e) => set('legalName', e.target.value)} name="legalName" autoComplete="off" />
            {err('legalName')}
          </label>
          <label className="lbl">Date of birth *
            <input type="date" className={`inp ${errors.dateOfBirth ? 'invalid' : ''}`} value={f.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('dateOfBirth', e.target.value)} name="dateOfBirth" />
            {err('dateOfBirth')}
          </label>
          <label className="lbl">Mobile (optional)
            <input className="inp" value={f.phone} onChange={(e) => set('phone', e.target.value)} type="tel" />
          </label>
          <label className="lbl span2">Main concern *
            <input className={`inp ${errors.mainConcern ? 'invalid' : ''}`} value={f.mainConcern} onChange={(e) => set('mainConcern', e.target.value)} name="mainConcern" placeholder="In the patient’s words" />
            {err('mainConcern')}
          </label>
          <label className="lbl">Pain (0–10)
            <select className="inp" value={f.pain} onChange={(e) => set('pain', e.target.value)}>
              <option value="">Not recorded</option>
              {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
          <label className="lbl">Insurance (optional)
            <input className="inp" value={f.insurance} onChange={(e) => set('insurance', e.target.value)} />
          </label>
          <label className="lbl">Zone
            <input className="inp" value={f.zone} onChange={(e) => set('zone', e.target.value)} placeholder="Zone A" />
          </label>
          <label className="lbl">Seat
            <input className="inp" value={f.seat} onChange={(e) => set('seat', e.target.value)} placeholder="Seat 04" />
          </label>
        </div>
        {netErr && <p className="banner-err" role="alert">{netErr}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add patient'}</button>
        </div>
      </form>
    </div>
  );
}

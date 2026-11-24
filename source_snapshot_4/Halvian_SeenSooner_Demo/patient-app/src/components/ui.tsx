import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes } from 'react';
import { ArrowLeft, ArrowRight, BrandCross, Globe, Warning } from '../ui/icons';
import { useApp } from '../context';
import { LANGUAGES } from '../i18n';

export function Wordmark() {
  return (
    <span className="wordmark">
      Seen<span className="accent">Sooner</span>
    </span>
  );
}

export function PatientHeader() {
  const { t, lang, openLanguageSheet } = useApp();
  const name = LANGUAGES.find((l) => l.code === lang)?.name ?? 'English';
  return (
    <header className="p-header">
      <div className="p-brand">
        <BrandCross size={24} />
        <Wordmark />
      </div>
      <button type="button" className="lang-pill" onClick={openLanguageSheet} aria-label={`${name} · ${t.change}`}>
        <Globe size={16} />
        <span>
          {name} · {t.change}
        </span>
      </button>
    </header>
  );
}

/** Phone-sized screen: header + scrollable main. */
export function Screen({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo?.(0, 0);
    ref.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [label]);
  return (
    <div className="p-screen">
      <PatientHeader />
      <main ref={ref} className={`p-main ${className}`} aria-label={label}>
        {children}
      </main>
    </div>
  );
}

export function BackLink({ onClick }: { onClick: () => void }) {
  const { t } = useApp();
  return (
    <button type="button" className="back-link" onClick={onClick}>
      <ArrowLeft size={18} className="flip-rtl" />
      <span>{t.back}</span>
    </button>
  );
}

export function Progress({ step, total = 5 }: { step: number; total?: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < step ? 'on' : ''} />
      ))}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
  busy,
  arrow = true,
  wide,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  busy?: boolean;
  arrow?: boolean;
  wide?: boolean;
  className?: string;
}) {
  return (
    <button type={type} className={`btn-primary ${wide ? 'wide' : ''} ${className}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="spinner" aria-hidden />}
      <span>{children}</span>
      {arrow && !busy && <ArrowRight size={18} className="flip-rtl" />}
    </button>
  );
}

export function EmergencyWarning() {
  const { t } = useApp();
  return (
    <div className="emergency" role="note">
      <Warning size={18} />
      <p>{t.emergency}</p>
    </div>
  );
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
  id,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const fid = id || auto;
  const errId = `${fid}-err`;
  const hintId = `${fid}-hint`;
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={fid} className={required ? 'req' : ''}>
        {label}
        {required ? ' *' : ''}
      </label>
      {children({
        id: fid,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [error ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Modal({ children, onClose, labelledBy, className = '' }: { children: ReactNode; onClose?: () => void; labelledBy: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, [href], input, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && onClose) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

export function Banner({ kind, children, action }: { kind: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {action}
    </div>
  );
}

import { useApp } from '../context';

export function Cover({ onStart }: { onStart: () => void }) {
  const { t } = useApp();
  return (
    <div className="cover">
      <p className="cover-brand">SeenSooner</p>
      <div className="cover-center">
        <h1 className="cover-title" tabIndex={-1}>
          <span>{t.coverTitle1}</span>
          <span>{t.coverTitle2}</span>
        </h1>
        <button type="button" className="cover-btn" onClick={onStart}>
          {t.startCheckIn}
        </button>
      </div>
      <p className="cover-foot">{t.emergencyDepartment}</p>
    </div>
  );
}

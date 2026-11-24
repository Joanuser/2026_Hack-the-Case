import { useApp } from '../context';
import { LANGUAGES, type Lang } from '../i18n';
import { Check } from '../ui/icons';
import { BackLink, PrimaryButton, Progress, Screen } from '../components/ui';

export function LanguageList({ onPick }: { onPick: (l: Lang) => void }) {
  const { lang } = useApp();
  return (
    <div className="lang-list" role="radiogroup">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={lang === l.code}
          className={`lang-option ${lang === l.code ? 'selected' : ''}`}
          onClick={() => onPick(l.code)}
          lang={l.code}
          dir={l.dir}
        >
          <span>{l.name}</span>
          {lang === l.code && <Check size={16} />}
        </button>
      ))}
    </div>
  );
}

export function Language({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t, setLang } = useApp();
  return (
    <Screen label="language">
      <BackLink onClick={onBack} />
      <div className="card lang-card">
        <p className="eyebrow">{t.patientCheckIn}</p>
        <Progress step={1} />
        <h1 tabIndex={-1}>{t.chooseLanguage}</h1>
        <p className="sub">{t.changeAnyTime}</p>
        <LanguageList onPick={setLang} />
        <div className="actions">
          <PrimaryButton onClick={onNext}>{t.continue}</PrimaryButton>
        </div>
        <p className="foot-note">{t.otherLanguage}</p>
      </div>
    </Screen>
  );
}

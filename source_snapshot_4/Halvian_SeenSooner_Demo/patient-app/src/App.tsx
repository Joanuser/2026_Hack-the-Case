import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ctx } from './context';
import { LANGUAGES, STRINGS, type Lang } from './i18n';
import { api, type LocationAuthorization, type PatientStatusView } from './api';
import { Modal } from './components/ui';
import { Close } from './ui/icons';
import { Cover } from './screens/Cover';
import { Scan, parseSiteCode } from './screens/Scan';
import { Language, LanguageList } from './screens/Language';
import { Info } from './screens/Info';
import { Symptoms } from './screens/Symptoms';
import { Review, emptySummary, toSymptoms, type SummaryState } from './screens/Review';
import { Waiting } from './screens/Waiting';
import { SymptomUpdate } from './screens/SymptomUpdate';
import { Details } from './screens/Details';
import { Slip } from './screens/Slip';
import { LeaveScan } from './screens/LeaveScan';
import { IS_TABLET } from './lib/device';
import { dobToIso, emptyInfo, emptySymptoms, validateInfo, validateSymptoms, type InfoForm, type SymptomForm } from './lib/validation';
import { DRAFT_KEY, LANG_KEY, SESSION_KEY, readJson, writeJson, type PatientSession } from './lib/storage';
import { getPosition } from './lib/geo';

type Route = 'cover' | 'scan' | 'language' | 'info' | 'symptoms' | 'review' | 'waiting' | 'details' | 'update' | 'slip' | 'leave';
const ROUTES: Route[] = ['cover', 'scan', 'language', 'info', 'symptoms', 'review', 'waiting', 'details', 'update', 'slip', 'leave'];
const PRE_SUBMIT: Route[] = ['cover', 'scan', 'language', 'info', 'symptoms', 'review'];

interface Draft {
  siteCode: string | null;
  locationDecided: boolean;
  locationAuthorization: LocationAuthorization | null;
  info: InfoForm;
  symptoms: SymptomForm;
  summary: SummaryState;
}

const emptyDraft: Draft = { siteCode: null, locationDecided: false, locationAuthorization: null, info: emptyInfo, symptoms: emptySymptoms, summary: emptySummary };

function readRoute(): Route {
  const r = window.location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'cover';
}

function initialLang(): Lang {
  const saved = readJson<Lang | null>(localStorage, LANG_KEY, null);
  if (saved && STRINGS[saved]) return saved;
  const nav = (navigator.language || 'en').slice(0, 2) as Lang;
  return STRINGS[nav] ? nav : 'en';
}

// Demo flow: Start goes straight to the personal-information page (no QR scan or
// language step). The site code defaults to the first configured code.
const DEFAULT_SITE = String(import.meta.env.VITE_SITE_CODES || 'ED-MAIN').split(',')[0].trim().toUpperCase() || 'ED-MAIN';

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [route, setRoute] = useState<Route>(readRoute);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = readJson<Partial<Draft>>(sessionStorage, DRAFT_KEY, {});
    const d = { ...emptyDraft, ...saved, locationAuthorization: saved.locationAuthorization ?? null };
    const urlSite = parseSiteCode(new URLSearchParams(window.location.search).get('site') || '');
    return { ...d, siteCode: urlSite || d.siteCode || DEFAULT_SITE };
  });
  const [session, setSession] = useState<PatientSession | null>(() => {
    const saved = readJson<PatientSession | null>(localStorage, SESSION_KEY, null);
    return saved ? { id: saved.id, token: saved.token, waitingNumber: saved.waitingNumber, locationAuthorization: saved.locationAuthorization ?? null } : null;
  });
  const [lastStatus, setLastStatus] = useState<PatientStatusView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const t = STRINGS[lang];
  const dir = LANGUAGES.find((l) => l.code === lang)?.dir ?? 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    writeJson(localStorage, LANG_KEY, lang);
  }, [lang, dir]);
  useEffect(() => writeJson(sessionStorage, DRAFT_KEY, draft), [draft]);
  useEffect(() => writeJson(localStorage, SESSION_KEY, session), [session]);
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((r: Route, replace = false) => {
    const url = `${window.location.pathname}${window.location.search}#/${r}`;
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setRoute(r);
  }, []);

  // ----- route guards -----
  const sessionClosed = lastStatus && ['left', 'completed'].includes(lastStatus.status);
  let effective: Route = route;
  if (IS_TABLET && route === 'leave') effective = 'leave';
  else if (!IS_TABLET && ['slip', 'leave'].includes(route)) effective = session ? 'waiting' : 'cover';
  else if (IS_TABLET && session && route !== 'slip') effective = 'slip';
  else if (IS_TABLET && !session && route === 'slip') effective = 'cover';
  else if (session && PRE_SUBMIT.includes(route) && !sessionClosed) effective = 'waiting';
  else if (!session && ['waiting', 'details', 'update'].includes(route)) effective = 'cover';
  else if (!session && ['scan', 'language'].includes(route)) effective = 'info';
  else if (route === 'symptoms' && Object.keys(validateInfo(draft.info, t)).length) effective = 'info';
  else if (route === 'review') {
    if (Object.keys(validateInfo(draft.info, t)).length) effective = 'info';
    else if (Object.keys(validateSymptoms(draft.symptoms, t)).length) effective = 'symptoms';
  }
  useEffect(() => { if (effective !== route) go(effective, true); }, [effective, route, go]);

  const onLocationDecision = async (allow: boolean) => {
    let granted = false;
    if (allow) {
      try { await getPosition(); granted = true; } catch { granted = false; }
    }
    const locationAuthorization = { granted, recordedAt: new Date().toISOString() };
    setDraft((d) => ({ ...d, locationDecided: true, locationAuthorization }));
    if (draft.siteCode) go('language');
  };

  const submit = async () => {
    const iso = dobToIso(draft.info.dob)!;
    const res = await api.createCheckIn({
      siteCode: draft.siteCode,
      language: lang,
      legalName: draft.info.legalName.trim(),
      dateOfBirth: iso,
      phone: draft.info.phone.trim(),
      insurance: draft.info.insuranceDeferred ? '' : draft.info.insurance.trim(),
      insuranceDeferred: draft.info.insuranceDeferred,
      accessibilityNeeds: draft.info.accessibility,
      symptoms: toSymptoms(draft.symptoms),
      summary: draft.summary.status === 'ready' ? { draft: draft.summary.draft, text: draft.summary.text, editedByPatient: draft.summary.editedByPatient } : undefined,
      locationAuthorization: draft.locationAuthorization ?? undefined,
    });
    setSession({ id: res.id, token: res.accessToken, waitingNumber: res.waitingNumber, locationAuthorization: draft.locationAuthorization });
    setLastStatus(res.status);
    go(IS_TABLET ? 'slip' : 'waiting', true);
  };

  const newCheckIn = () => {
    setSession(null);
    setLastStatus(null);
    setDraft((d) => ({ ...emptyDraft, siteCode: d.siteCode, locationDecided: d.locationDecided, locationAuthorization: d.locationAuthorization }));
    go('cover', true);
  };

  const ctx = useMemo(() => ({ lang, t, setLang: setLangState, openLanguageSheet: () => setSheet(true) }), [lang, t]);
  const onStatus = useCallback((s: PatientStatusView) => setLastStatus(s), []);
  const clearFlash = useCallback(() => setFlash(null), []);

  let screen: React.ReactNode = null;
  switch (effective) {
    case 'cover':
      screen = <Cover onStart={() => { setDraft((d) => ({ ...d, siteCode: d.siteCode || DEFAULT_SITE })); go('info'); }} onLeave={IS_TABLET ? () => go('leave') : undefined} />;
      break;
    case 'slip':
      screen = session && <Slip session={session} onDone={newCheckIn} />;
      break;
    case 'leave':
      screen = <LeaveScan onExit={() => go('cover', true)} />;
      break;
    case 'scan':
      screen = (
        <Scan
          locationDecided={draft.locationDecided}
          onLocationDecision={onLocationDecision}
          siteCode={draft.siteCode}
          onSite={(c) => { setDraft((d) => ({ ...d, siteCode: c })); go('language'); }}
        />
      );
      break;
    case 'language':
      screen = <Language onBack={() => go('scan')} onNext={() => go('info')} />;
      break;
    case 'info':
      screen = <Info value={draft.info} onChange={(info) => setDraft((d) => ({ ...d, info }))} onBack={() => go('cover')} onNext={() => go('symptoms')} />;
      break;
    case 'symptoms':
      screen = <Symptoms value={draft.symptoms} onChange={(symptoms) => setDraft((d) => ({ ...d, symptoms }))} onBack={() => go('info')} onNext={() => go('review')} />;
      break;
    case 'review':
      screen = (
        <Review
          info={draft.info}
          symptoms={draft.symptoms}
          summary={draft.summary}
          setSummary={(summary) => setDraft((d) => ({ ...d, summary }))}
          onBack={() => go('symptoms')}
          onEditInfo={() => go('info')}
          onSubmit={submit}
        />
      );
      break;
    case 'waiting':
      screen = session && (
        <Waiting
          session={session}
          flash={flash}
          clearFlash={clearFlash}
          onBack={() => go('details')}
          onSymptomsChanged={() => go('update')}
          onNewCheckIn={newCheckIn}
          onStatus={onStatus}
        />
      );
      break;
    case 'details':
      screen = session && <Details info={draft.info} status={lastStatus} waitingNumber={session.waitingNumber} onBack={() => go('waiting')} />;
      break;
    case 'update':
      screen = session && (
        <SymptomUpdate
          session={session}
          current={lastStatus}
          onBack={() => go('waiting')}
          onSent={(s) => { setLastStatus(s); setFlash(t.updateSent); go('waiting'); }}
        />
      );
      break;
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className={IS_TABLET ? 'device tablet' : 'device'}>{screen}</div>
      {sheet && (
        <Modal labelledBy="lang-sheet-title" onClose={() => setSheet(false)} className="lang-sheet">
          <div className="sheet-head">
            <h2 id="lang-sheet-title">{t.chooseLanguage}</h2>
            <button type="button" className="icon-btn" onClick={() => setSheet(false)} aria-label={t.close}><Close /></button>
          </div>
          <p className="sub">{t.changeAnyTime}</p>
          <LanguageList onPick={(l) => { setLangState(l); setSheet(false); }} />
        </Modal>
      )}
    </Ctx.Provider>
  );
}

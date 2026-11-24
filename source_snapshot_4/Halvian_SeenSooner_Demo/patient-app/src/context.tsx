import { createContext, useContext } from 'react';
import type { Lang, Strings } from './i18n';

export interface AppCtx {
  lang: Lang;
  t: Strings;
  setLang: (l: Lang) => void;
  openLanguageSheet: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

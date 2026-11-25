const ALLOWED = String(import.meta.env.VITE_SITE_CODES || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/** Accepts `https://…?site=CODE`, `SEENSOONER:CODE` or a bare code. Returns the code or null. */
export function parseSiteCode(raw: string): string | null {
  let code = raw.trim();
  try {
    const u = new URL(code);
    code = u.searchParams.get('site') || '';
  } catch {
    code = code.replace(/^seensooner:/i, '');
  }
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) return null;
  if (ALLOWED.length && !ALLOWED.includes(code)) return null;
  return code;
}

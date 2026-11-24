// Icons redrawn as inline SVG to match the Figma icon set (Figma asset URLs are temporary).
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, p: P) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, focusable: false, ...p });

/** SeenSooner brand cross (Figma component "Halvian cross"). */
export function BrandCross({ size = 24, ...p }: P) {
  return (
    <svg {...base(size, p)} viewBox="0 0 28 28">
      <path d="M11 3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 17 3.5V11h7.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H17v7.5a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5V17H3.5A1.5 1.5 0 0 1 2 15.5v-3A1.5 1.5 0 0 1 3.5 11H11V3.5Z" fill="#6b4eb5" />
    </svg>
  );
}

export function Globe({ size = 16, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}

export function ArrowRight({ size = 18, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowLeft({ size = 18, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function Check({ size = 16, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function Warning({ size = 18, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5M12 17.2h.01" />
    </svg>
  );
}

export function ChevronDown({ size = 16, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronRight({ size = 16, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function Sparkle({ size = 18, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" />
    </svg>
  );
}

export function Shield({ size = 18, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  );
}

export function Camera({ size = 16, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function Pin({ size = 26, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function Filter({ size = 16, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  );
}

export function SortBoth({ dir, ...p }: P & { dir?: 'asc' | 'desc' | null }) {
  return (
    <svg width={10} height={12} viewBox="0 0 10 12" aria-hidden focusable={false} {...p}>
      <path d="M5 1 8.5 5h-7L5 1Z" fill={dir === 'asc' ? '#6d4fc2' : '#b3adbd'} />
      <path d="M5 11 1.5 7h7L5 11Z" fill={dir === 'desc' ? '#6d4fc2' : '#b3adbd'} />
    </svg>
  );
}

export function Close({ size = 18, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function Plus({ size = 16, ...p }: P) {
  return (
    <svg {...base(size, p)} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'http' | 'memory';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MOCK_BACKEND?: string;
  readonly VITE_STAFF_NAME?: string;
  readonly VITE_STAFF_API_TOKEN?: string;
  readonly VITE_SITE_CODES?: string;
  readonly VITE_HOSPITAL_LAT?: string;
  readonly VITE_HOSPITAL_LNG?: string;
  readonly VITE_EXIT_RADIUS_METERS?: string;
  readonly VITE_DEPARTMENT_NAME?: string;
  readonly VITE_ROWS_PER_PAGE?: string;
  readonly VITE_BACKEND_LABEL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }

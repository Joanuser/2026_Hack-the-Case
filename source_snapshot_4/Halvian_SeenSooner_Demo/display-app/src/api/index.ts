// Entry point for all backend access. Components import `api` from here only.
import { createHttpApi } from './httpAdapter';
import { createMemoryApi } from './memoryAdapter';
import type { SeenSoonerApi } from './types';

export * from './types';

const env = import.meta.env;
const mode = (env.VITE_API_MODE || 'http') as 'http' | 'memory';
const baseUrl = (env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:4000';

export const api: SeenSoonerApi =
  mode === 'memory'
    ? createMemoryApi()
    : createHttpApi(baseUrl, {
        staffName: env.VITE_STAFF_NAME as string | undefined,
        staffToken: env.VITE_STAFF_API_TOKEN as string | undefined,
      });

/** True when talking to the bundled mock server or the in-browser mock. */
export const isMockMode = mode === 'memory' || env.VITE_MOCK_BACKEND === 'true';

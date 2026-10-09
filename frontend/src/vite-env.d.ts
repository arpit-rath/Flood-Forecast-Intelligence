/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed Varuna API, e.g. https://xxxx.execute-api.region.amazonaws.com */
  readonly VITE_API_BASE_URL?: string;
  /** "false" to call the real API; anything else uses local fixtures. */
  readonly VITE_USE_MOCKS?: string;
  /** Optional MapLibre style URL for a basemap. */
  readonly VITE_BASEMAP_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

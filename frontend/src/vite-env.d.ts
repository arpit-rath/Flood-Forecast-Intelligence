/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed Varuna API, e.g. https://xxxx.execute-api.region.amazonaws.com */
  readonly VITE_API_BASE_URL?: string;
  /** "false" to call the real API; anything else uses local fixtures. */
  readonly VITE_USE_MOCKS?: string;
  /** Public Amazon Location Hybrid descriptor URL for the Delhi-only basemap. */
  readonly VITE_DELHI_HYBRID_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

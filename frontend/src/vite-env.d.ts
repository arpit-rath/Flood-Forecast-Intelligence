/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed Varuna API, e.g. https://xxxx.execute-api.region.amazonaws.com */
  readonly VITE_API_BASE_URL?: string;
  /** "false" to call the real API; anything else uses local fixtures. */
  readonly VITE_USE_MOCKS?: string;
  /** Public Amazon Location Hybrid descriptor URL for the Delhi-only basemap. */
  readonly VITE_DELHI_HYBRID_STYLE_URL?: string;
  /** Public Cognito managed-login origin; never a client secret. */
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REDIRECT_URI?: string;
  /** Set to "false" and rebuild when Cognito public self-sign-up is disabled. UI wording only. */
  readonly VITE_PUBLIC_SIGNUP_ENABLED?: string;
  /** Loopback-only local demo sign-in, not for deployed builds. */
  readonly VITE_LOCAL_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

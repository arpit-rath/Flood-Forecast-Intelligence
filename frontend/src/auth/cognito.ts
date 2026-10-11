/** Cognito managed-login authorization-code flow with PKCE. Tokens stay in memory. */

export interface SignedInUser {
  accessToken: string;
  displayName: string;
  roles: string[];
  expiresAt: string;
}

const PENDING_KEY = 'varuna-oauth-pending';

function config() {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (!domain || !clientId) throw new Error('Cognito sign-in is not configured.');
  const origin = new URL(domain);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Cognito domain must be an HTTPS origin.');
  }
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/`;
  const callback = new URL(redirectUri);
  if (callback.origin !== window.location.origin || callback.hash) throw new Error('Cognito callback must use this site origin without a fragment.');
  return { domain: origin.origin, clientId, redirectUri };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function tokenClaims(token: string): Record<string, unknown> {
  const encoded = token.split('.')[1];
  if (!encoded) throw new Error('Sign-in did not return a usable access token.');
  const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '='));
  return JSON.parse(json) as Record<string, unknown>;
}

export async function beginCognitoSignIn(): Promise<void> {
  const { domain, clientId, redirectUri } = config();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, returnHash: window.location.hash }));
  const url = new URL('/oauth2/authorize', domain);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid email', code_challenge_method: 'S256', code_challenge: challenge, state }).toString();
  window.location.assign(url.toString());
}

export async function completeCognitoSignIn(): Promise<SignedInUser | null> {
  const query = new URLSearchParams(window.location.search);
  if (!query.has('code') && !query.has('error')) return null;
  const pendingRaw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  const clean = () => window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  if (!pendingRaw) { clean(); throw new Error('Sign-in session expired. Please try again.'); }
  const pending = JSON.parse(pendingRaw) as { verifier: string; state: string; returnHash: string };
  if (query.get('error')) { clean(); throw new Error('Cognito sign-in was cancelled or denied. Please try again.'); }
  if (query.get('state') !== pending.state || !query.get('code')) { clean(); throw new Error('Sign-in state did not match. Please try again.'); }
  const { domain, clientId, redirectUri } = config();
  const response = await fetch(new URL('/oauth2/token', domain), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: query.get('code')!, redirect_uri: redirectUri, code_verifier: pending.verifier }),
    credentials: 'omit',
  });
  clean();
  if (!response.ok) throw new Error('Cognito could not complete sign-in. Please try again.');
  const token = await response.json() as { access_token?: string; token_type?: string; expires_in?: number };
  if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Cognito did not return an access token.');
  const claims = tokenClaims(token.access_token);
  if (claims.token_use !== 'access' || claims.client_id !== clientId || typeof claims.sub !== 'string' || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    throw new Error('Cognito returned an invalid access token.');
  }
  const groups = claims['cognito:groups'];
  window.location.hash = pending.returnHash || '#/resident';
  return {
    accessToken: token.access_token,
    displayName: typeof claims.username === 'string' ? claims.username : 'Signed-in user',
    roles: Array.isArray(groups) ? groups.filter((group): group is string => typeof group === 'string') : [],
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function endCognitoSignIn(): void {
  const { domain, clientId } = config();
  const url = new URL('/logout', domain);
  url.search = new URLSearchParams({ client_id: clientId, logout_uri: `${window.location.origin}/` }).toString();
  window.location.assign(url.toString());
}

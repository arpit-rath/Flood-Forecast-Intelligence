// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { completeCognitoSignIn } from './cognito';

beforeEach(() => {
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://demo.auth.ap-south-1.amazoncognito.com');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'public-client');
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', `${window.location.origin}/`);
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); });

test('PKCE callback rejects a mismatched state before exchanging a code', async () => {
  sessionStorage.setItem('varuna-oauth-pending', JSON.stringify({ verifier: 'verifier', state: 'correct', returnHash: '#/resident' }));
  window.history.replaceState(null, '', '/?code=authorization-code&state=wrong');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(completeCognitoSignIn()).rejects.toThrow(/state did not match/);
  expect(fetch).not.toHaveBeenCalled();
  expect(window.location.search).toBe('');
});

test('PKCE callback exchanges code for an access token and restores the workspace', async () => {
  sessionStorage.setItem('varuna-oauth-pending', JSON.stringify({ verifier: 'secret-verifier', state: 'correct', returnHash: '#/responder' }));
  window.history.replaceState(null, '', '/?code=authorization-code&state=correct');
  const claims = { sub: 'assigned-responder', token_use: 'access', client_id: 'public-client', exp: Math.floor(Date.now() / 1000) + 600, username: 'responder', 'cognito:groups': ['varuna-responder'] };
  const token = `header.${btoa(JSON.stringify(claims))}.signature`;
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 600 }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const user = await completeCognitoSignIn();
  expect(user?.displayName).toBe('responder');
  expect(user?.roles).toEqual(['varuna-responder']);
  expect(window.location.hash).toBe('#/responder');
  expect(window.location.search).toBe('');
  const [url, options] = fetch.mock.calls[0] as [URL, RequestInit];
  expect(url.pathname).toBe('/oauth2/token');
  expect(new URLSearchParams(options.body as string).get('code_verifier')).toBe('secret-verifier');
});

test('a self-registered user without responder group gets resident-level access', async () => {
  sessionStorage.setItem('varuna-oauth-pending', JSON.stringify({ verifier: 'resident-verifier', state: 'correct', returnHash: '#/resident' }));
  window.history.replaceState(null, '', '/?code=resident-code&state=correct');
  const claims = { sub: 'new-resident', token_use: 'access', client_id: 'public-client', exp: Math.floor(Date.now() / 1000) + 600, username: 'new-resident' };
  const token = `header.${btoa(JSON.stringify(claims))}.signature`;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 600 }), { status: 200 })));
  const user = await completeCognitoSignIn();
  expect(user?.roles).toEqual([]);
  expect(user?.displayName).toBe('new-resident');
  expect(window.location.hash).toBe('#/resident');
});

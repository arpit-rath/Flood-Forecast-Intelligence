// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useAppState } from '../state/AppState';
import { SignInPanel } from './SignInPanel';

vi.mock('../state/AppState', () => ({ useAppState: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

test('managed login offers account creation without promising responder access', () => {
  vi.stubEnv('VITE_PUBLIC_SIGNUP_ENABLED', 'true');
  vi.mocked(useAppState).mockReturnValue({
    api: { kind: 'http', authMode: 'cognito' },
    auth: { status: 'signed_out' },
    signInLocal: vi.fn(),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAppState>);

  const { rerender } = render(<SignInPanel />);
  expect(screen.getByRole('button', { name: 'Sign in or create account' })).toBeTruthy();
  expect(screen.getByText(/New reports remain Pending Review/)).toBeTruthy();

  rerender(<SignInPanel responderOnly />);
  expect(screen.getByText(/New accounts can submit pilot reports but cannot open the review queue/)).toBeTruthy();
});

test('post-event sign-in-only wording does not advertise account creation', () => {
  vi.stubEnv('VITE_PUBLIC_SIGNUP_ENABLED', 'false');
  vi.mocked(useAppState).mockReturnValue({
    api: { kind: 'http', authMode: 'cognito' },
    auth: { status: 'signed_out' },
    signInLocal: vi.fn(),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAppState>);
  render(<SignInPanel />);
  expect(screen.getByRole('button', { name: 'Sign in with Varuna' })).toBeTruthy();
  expect(screen.queryByText(/create an account/i)).toBeNull();
});

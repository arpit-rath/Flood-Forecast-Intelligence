import { useId, useState, type FormEvent } from 'react';
import { useAppState } from '../state/AppState';

export function SignInPanel({ responderOnly = false }: { responderOnly?: boolean }) {
  const { api, auth, signInLocal, beginSignIn, signOut } = useAppState();
  const id = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const publicSignup = api.authMode === 'cognito' && import.meta.env.VITE_PUBLIC_SIGNUP_ENABLED !== 'false';
  if (api.kind === 'mock') return null;

  if (auth.status === 'signed_in') {
    const responder = auth.user?.roles.includes('varuna-responder');
    return <div className="sign-in-panel">
      <p className="detail">Signed in as {auth.user?.displayName}. {responder ? 'Responder review access.' : 'Report submission access.'}</p>
      {responderOnly && !responder && <p className="field-error" role="status">Only a varuna-responder account can view or review private reports. You can still submit a pilot report.</p>}
      <button type="button" className="btn btn--secondary" onClick={signOut}>Sign out</button>
    </div>;
  }

  return <div className="sign-in-panel" aria-busy={auth.status === 'signing_in'}>
    <p className="detail">{responderOnly ? (publicSignup ? 'Private report review requires a varuna-responder account. New accounts can submit pilot reports but cannot open the review queue.' : 'Private report review requires a varuna-responder account.') : (publicSignup ? 'Sign in or create an account to submit a photo for the synthetic pilot. New reports remain Pending Review.' : 'Sign in to submit a photo for the synthetic pilot. New reports remain Pending Review.')}</p>
    {api.authMode === 'cognito' && <button type="button" className="btn btn--secondary" disabled={auth.status === 'signing_in'} onClick={() => void beginSignIn()}>
      {auth.status === 'signing_in' ? 'Opening sign-in…' : (publicSignup ? 'Sign in or create account' : 'Sign in with Varuna')}
    </button>}
    {api.authMode === 'local' && <form onSubmit={(event: FormEvent) => { event.preventDefault(); void signInLocal(username, password); }}>
      <div className="field"><label htmlFor={`${id}-user`}>Demo account</label><input id={`${id}-user`} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
      <div className="field"><label htmlFor={`${id}-password`}>Password</label><input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
      <button type="submit" className="btn btn--secondary" disabled={auth.status === 'signing_in'}>{auth.status === 'signing_in' ? 'Signing in…' : 'Sign in to local demo'}</button>
    </form>}
    {api.authMode === 'unavailable' && <p className="field-error" role="status">Sign-in is not configured for this site. Report submission and private review are unavailable.</p>}
    {auth.status === 'error' && <p className="field-error" role="alert">{auth.error}</p>}
  </div>;
}

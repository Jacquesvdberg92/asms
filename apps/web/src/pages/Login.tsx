import { useState } from 'react';
import { useStore } from '../lib/store';
import { Button, Field } from '../components/ui';

export default function Login() {
  const { signIn } = useStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="card-body stack">
          <div className="row">
            <div className="brand-mark">🦖</div>
            <div>
              <h2>ASMS</h2>
              <div className="small faint">Ark Server Management Suite</div>
            </div>
          </div>
          <Field label="Password" error={error}>
            <input
              className="input"
              type="password"
              value={password}
              autoFocus
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your ASMS password"
            />
          </Field>
          <Button type="submit" variant="primary" block busy={busy}>
            Sign in
          </Button>
          <p className="tiny faint center">
            Lost it? Stop ASMS, clear the <span className="mono">password</span> field in{' '}
            <span className="mono">data/asms.json</span>, and start it again.
          </p>
        </div>
      </form>
    </div>
  );
}

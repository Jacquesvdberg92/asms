import { useState } from 'react';
import { useStore } from '../lib/store';
import { Button, Callout, Field } from '../components/ui';

/**
 * First run: pick the dashboard password.
 *
 * ASMS used to invent one and print it to the console. Anyone who started it
 * from a shortcut, ran it as a service, or pulled a fresh copy from GitHub met
 * a sign-in screen asking for a password that existed nowhere - so it asks
 * here, where somebody is actually looking, and nothing else in the API answers
 * until this is done.
 */
export default function Setup() {
  const { completeSetup } = useStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const save = async (chosen: string) => {
    setBusy(true);
    setError('');
    try {
      await completeSetup(chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 4) {
      setError('Pick at least 4 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those two do not match.');
      return;
    }
    await save(password);
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="card-body stack">
          <div className="row">
            <div className="brand-mark">🦖</div>
            <div>
              <h2>Welcome to ASMS</h2>
              <div className="small faint">Ark Server Management Suite</div>
            </div>
          </div>

          <p className="small dim">
            Pick a password for this dashboard. It is the only thing standing between anyone who can reach this machine
            and your servers — it is not your ARK admin or RCON password.
          </p>

          <Field label="Password" error={error}>
            <input
              className="input"
              type="password"
              value={password}
              autoFocus
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 4 characters"
            />
          </Field>
          <Field label="Password again">
            <input
              className="input"
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type it once more"
            />
          </Field>

          <Button type="submit" variant="primary" block busy={busy}>
            Set password and continue
          </Button>

          {skipping ? (
            <Callout
              tone="warn"
              title="Sure? Anyone who can reach ASMS gets full control"
              action={
                <Button size="sm" busy={busy} onClick={() => void save('')}>
                  Yes, no password
                </Button>
              }
            >
              They could start, stop, wipe or reconfigure every server on this machine. Reasonable if ASMS only listens
              on <span className="mono">127.0.0.1</span> or sits behind something that already asks who you are. You can
              set one later under Settings → Access.
            </Callout>
          ) : (
            <Button type="button" variant="ghost" size="sm" block onClick={() => setSkipping(true)}>
              Run without a password
            </Button>
          )}

          <p className="tiny faint center">
            Forget it later? Stop ASMS, empty the <span className="mono">passwordHash</span> field in{' '}
            <span className="mono">data/asms.json</span>, and start it again — you will land back here.
          </p>
        </div>
      </form>
    </div>
  );
}

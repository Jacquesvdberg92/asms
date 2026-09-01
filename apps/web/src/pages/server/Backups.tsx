import { useState } from 'react';
import { useStore, useAction } from '../../lib/store';
import { api, download } from '../../lib/api';
import { Button, Confirm, Empty, Field, Badge, Callout, SearchInput } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help } from '../../components/Tooltip';
import { bytes, dateTime, when } from '../../lib/format';
import { matches } from '../../lib/search';
import type { BackupEntry, ServerInstance, ServerRuntime } from '../../lib/types';

export default function Backups({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { backups, settings } = useStore();
  const [busy, run] = useAction();
  const [note, setNote] = useState('');
  const [find, setFind] = useState('');
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);
  const [deleting, setDeleting] = useState<BackupEntry | null>(null);

  const rows = backups.filter((b) => b.serverId === server.id);
  const shown = rows.filter((b) => matches(find, b.note, b.reason, dateTime(b.createdAt), when(b.createdAt)));
  const total = rows.reduce((sum, b) => sum + b.sizeBytes, 0);
  const stopped = runtime?.state === 'stopped' || runtime?.state === 'crashed';

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon.Archive />
          <h3>Backups</h3>
          <Help
            title="What is in a backup"
            body="A zip of the SavedArks folder plus both INI files, so restoring brings back the world and the rules that went with it."
          />
          <span className="badge">{rows.length}</span>
          <div className="spacer" />
          {rows.length > 4 ? (
            <SearchInput value={find} onChange={setFind} width={240} placeholder="Find a backup by note or date…" hint={find ? `${shown.length} of ${rows.length}` : undefined} />
          ) : null}
          <span className="card-hint">
            {bytes(total)} on disk · keeping the newest {settings?.backupRetention ?? 20}
          </span>
        </div>
        <div className="card-body stack">
          <Field label="Take a backup now" help="Zips SavedArks plus both INI files. Safe to run while the server is up — ARK saves atomically.">
            <div className="input-group">
              <input className="input" placeholder="Optional note, e.g. before boss fight" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                variant="primary"
                busy={busy}
                onClick={() =>
                  void run(async () => {
                    await api.post(`/servers/${server.id}/backup`, { note });
                    setNote('');
                  }, 'Backup created')
                }
              >
                <Icon.Archive size={14} /> Back up
              </Button>
            </div>
          </Field>
          {rows.length && !stopped ? (
            <Callout tone="info" title="Restoring needs the server stopped">
              Taking a backup while it runs is fine. Putting one back is not — ARK holds the save files open and overwrites
              them on shutdown, so a restore into a running server would be undone the moment it stops.
            </Callout>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <Empty icon="📦" title="No backups yet" body="Take one now, or add a scheduled backup under the Schedule tab so it happens without you thinking about it." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Taken</th>
                  <th>Reason</th>
                  <th className="right">Size</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((backup) => (
                  <tr key={backup.id}>
                    <td>
                      <div>{dateTime(backup.createdAt)}</div>
                      <div className="tiny faint">{when(backup.createdAt)}</div>
                      {backup.note ? <div className="tiny dim">{backup.note}</div> : null}
                    </td>
                    <td>
                      <Badge tone={backup.reason === 'scheduled' ? 'info' : backup.reason === 'manual' ? undefined : 'warn'}>
                        {backup.reason}
                      </Badge>
                    </td>
                    <td className="right num">{bytes(backup.sizeBytes)}</td>
                    <td className="right">
                      <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => void download(`/backups/${backup.id}/download`)}>
                          <Icon.Download size={13} /> Download
                        </button>
                        <Button size="sm" disabled={!stopped} title={stopped ? '' : 'Stop the server first'} onClick={() => setRestoring(backup)}>
                          Restore
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(backup)}>
                          <Icon.Trash size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {find && !shown.length ? (
              <div className="card-body small faint">No backup matches “{find}”.</div>
            ) : null}
          </div>
        )}
      </div>

      {restoring ? (
        <Confirm
          title="Restore this backup?"
          danger
          confirmLabel="Restore"
          requireText="restore"
          onClose={() => setRestoring(null)}
          onConfirm={() => void run(() => api.post(`/backups/${restoring.id}/restore`), 'Backup restored')}
          body={
            <p>
              The current saves will be replaced with the ones from {dateTime(restoring.createdAt)}. ASMS takes a safety backup of the
              current state first, so this is reversible.
            </p>
          }
        />
      ) : null}

      {deleting ? (
        <Confirm
          title="Delete this backup?"
          danger
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => void run(() => api.del(`/backups/${deleting.id}`), 'Backup deleted')}
          body={<p>The zip file is removed from disk. This cannot be undone.</p>}
        />
      ) : null}
    </div>
  );
}

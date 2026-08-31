import { useRef, useState } from 'react';
import { useStore, useAction } from '../lib/store';
import { api } from '../lib/api';
import { Button, Badge, Callout, Field, Modal, Toggle } from './ui';
import { Icon } from './Icons';
import { Help } from './Tooltip';
import { downloadJson, readJsonFile } from '../lib/setups';
import { ARCHIVE_PART_LABELS, archiveFileName, defaultArchiveParts } from '../lib/archive';
import { dateTime } from '../lib/format';
import type { ArchiveImportResult, ArchiveParts, ArchiveSummary } from '../lib/types';

/** A file the user picked, plus what the server says is inside it. */
interface Pending {
  archive: unknown;
  summary: ArchiveSummary;
  fileName: string;
}

/**
 * Moving ASMS to another PC, in two buttons. Export writes one file with every
 * server, INI, mod, schedule, setup and setting in it; import reads that file
 * back and you are running again.
 *
 * The file carries passwords on purpose - a restore that loses admin access to
 * four servers is not a restore - so the card says so plainly and offers the
 * stripped version for the case where the file is going somewhere else.
 */
export function BackupMigrate() {
  const { toast } = useStore();
  const [busy, run] = useAction();
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const exportAll = () =>
    void run(async () => {
      const bundle = await api.post<{ host: string; exportedAt: number }>('/archive/export', { includeSecrets });
      downloadJson(archiveFileName(bundle), bundle);
    }, 'Backup file saved');

  const take = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const archive = await readJsonFile(file);
      const summary = await api.post<ArchiveSummary>('/archive/preview', { archive });
      setPending({ archive, summary, fileName: file.name });
    });
  };

  return (
    <>
      <div className="card" id="backup">
        <div className="card-head">
          <Icon.Archive />
          <h3>The configuration file</h3>
          <Help
            title="Everything, in one file"
            body="Servers with their ports, passwords, mods and both INI files, your schedules, the mod and cluster library, saved setups and these settings. Restore it on another PC and the only thing left to do is install the game files."
          />
          <div className="spacer" />
          <span className="card-hint">One file in, one file out</span>
        </div>

        <div className="card-body stack">
          <div className="row row-wrap" style={{ gap: 12 }}>
            <Button variant="primary" busy={busy} onClick={exportAll}>
              <Icon.Download /> Export everything
            </Button>
            <span className="small faint" style={{ flex: 1, minWidth: 220 }}>
              Saves one <span className="mono">.asms-archive.json</span> — servers, mods, schedules, setups, library and
              settings.
            </span>
          </div>

          <Toggle
            checked={includeSecrets}
            onChange={setIncludeSecrets}
            title="Include passwords"
            help="On: the file can restore working servers, and is as sensitive as your admin password. Off: safe to store anywhere, but every password comes back blank."
          />
          {includeSecrets ? (
            <Callout tone="warn" title="This file will contain your passwords in plain text">
              Admin, join and spectator passwords for every server, plus the ASMS password itself. Treat the file the way you
              treat those passwords — do not put it in a Discord channel or a public repo. Turn the switch off for a copy you
              can share.
            </Callout>
          ) : (
            <Callout tone="info" title="Passwords will be blank in this file">
              Safe to store anywhere, but a restore from it leaves every server without admin access until you type the
              passwords back in.
            </Callout>
          )}

          <div className="divider" />

          <div
            className={`drop-zone ${over ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              take(e.dataTransfer.files?.[0]);
            }}
          >
            <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
              <span>Drop an .asms-archive.json backup here to restore it</span>
              <Button size="sm" busy={busy} onClick={() => input.current?.click()}>
                <Icon.File size={13} /> Choose a file
              </Button>
            </div>
          </div>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              take(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <div className="card-foot">
          <span className="card-hint">
            Save games, mod downloads and backup zips are far too big to live in a JSON file, so they are not in it — copy
            those folders across as well, or install fresh and restore a backup afterwards.
          </span>
        </div>
      </div>

      {pending ? (
        <RestoreDialog
          pending={pending}
          onClose={() => setPending(null)}
          onDone={(result) => {
            setPending(null);
            if (result.warnings.length) toast('warn', 'Restored, with notes', result.warnings.join(' '));
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------- restoring

function RestoreDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: Pending;
  onClose: () => void;
  onDone: (result: ArchiveImportResult) => void;
}) {
  const { servers, runtimes, refresh, refreshSystem } = useStore();
  const [busy, run] = useAction();
  const [parts, setParts] = useState<ArchiveParts>(defaultArchiveParts());
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [rebasePaths, setRebasePaths] = useState(false);
  const { summary } = pending;

  const running = servers.filter((server) => (runtimes[server.id]?.state ?? 'stopped') !== 'stopped');
  const nothingPicked = !parts.servers && !parts.library && !parts.setups && !parts.settings;

  const restore = () =>
    void run(async () => {
      const result = await api.post<ArchiveImportResult>('/archive/import', {
        archive: pending.archive,
        parts,
        mode,
        rebasePaths,
      });
      await refresh();
      await refreshSystem();
      onDone(result);
      return result;
    }, 'Backup restored');

  return (
    <Modal
      title="Restore a backup"
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={mode === 'replace' ? 'danger' : 'primary'}
            busy={busy}
            disabled={nothingPicked || running.length > 0}
            onClick={restore}
          >
            <Icon.Upload /> {mode === 'replace' ? 'Replace everything' : 'Restore'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="row row-wrap" style={{ gap: 8 }}>
          <span className="mono small truncate">{pending.fileName}</span>
          <div className="spacer" />
          <Badge>{summary.host}</Badge>
          <span className="tiny faint">{dateTime(summary.exportedAt)}</span>
          {summary.hasSecrets ? <Badge tone="ok">with passwords</Badge> : <Badge tone="warn">no passwords</Badge>}
        </div>

        <div className="row row-wrap" style={{ gap: 6 }}>
          <Badge>{summary.counts.servers} servers</Badge>
          <Badge>{summary.counts.schedules} tasks</Badge>
          <Badge>{summary.counts.setups} setups</Badge>
          <Badge>{summary.counts.mods} mods</Badge>
          <Badge>{summary.counts.clusters} cluster IDs</Badge>
        </div>

        {summary.servers.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Map</th>
                  <th>Install folder</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                {summary.servers.map((server) => (
                  <tr key={server.id}>
                    <td className="strong">{server.name}</td>
                    <td className="dim">{server.map}</td>
                    <td className="dim mono truncate" style={{ maxWidth: 260 }}>
                      {server.installPath || '—'}
                    </td>
                    <td className="dim">
                      {server.conflict || (mode === 'replace' ? 'restored' : 'added')}
                      {server.hasConfig ? ' · with its INI files' : ' · no INI files in this backup'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {summary.warnings.map((warning) => (
          <Callout tone="warn" key={warning}>
            {warning}
          </Callout>
        ))}

        <div className="divider" />
        <span className="small dim">What to restore</span>
        <div className="stack" style={{ gap: 10 }}>
          {ARCHIVE_PART_LABELS.map(({ key, title, help }) => (
            <Toggle
              key={key}
              checked={parts[key]}
              onChange={(value) => setParts({ ...parts, [key]: value })}
              title={title}
              help={help}
            />
          ))}
        </div>

        <div className="divider" />
        <Field label="How to deal with what is already here">
          <div className="row row-wrap">
            <button className={`btn btn-sm ${mode === 'merge' ? 'btn-primary' : ''}`} onClick={() => setMode('merge')}>
              Merge — keep what is here
            </button>
            <button
              className={`btn btn-sm ${mode === 'replace' ? 'btn-danger' : ''}`}
              onClick={() => setMode('replace')}
            >
              Replace everything
            </button>
          </div>
        </Field>
        {mode === 'merge' ? (
          <Callout tone="ok" title="The safe one">
            Servers in the backup are added, or updated in place when ASMS already knows them. Anything else here is left
            alone.
          </Callout>
        ) : (
          <Callout tone="danger" title="ASMS will forget every server it currently has">
            Only what is in this file survives — servers, schedules and setups not in it are dropped from ASMS. No files on
            disk are deleted: installs, save games and backup zips all stay where they are, but you would have to add those
            servers again by hand.
          </Callout>
        )}

        <Toggle
          checked={rebasePaths}
          onChange={setRebasePaths}
          title="This is a different PC — put installs under my folders"
          help={`Install paths from the backup are replaced with folders under this machine's install root, and this machine's folder settings are kept.`}
        />

        {running.length ? (
          <Callout tone="danger" title={`Stop ${running.map((server) => server.name).join(', ')} first`}>
            Restoring rewrites what those servers are — ports, passwords, mods — and ARK only reads that at boot. A running
            server would carry on with the old values while ASMS showed the new ones, which is the hardest kind of problem to
            spot. The Restore button stays disabled until they are stopped.
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}

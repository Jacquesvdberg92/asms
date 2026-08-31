import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { TopBar } from '../components/Shell';
import { Badge, Callout, Empty } from '../components/ui';
import { Icon } from '../components/Icons';
import { BackupMigrate } from '../components/BackupMigrate';
import { dateTime } from '../lib/format';

/**
 * Two different things get called "a backup" and mixing them up is how people
 * lose a world: this page is the *configuration* archive - what ASMS knows
 * about your servers - while the zip of the actual save game lives on each
 * server's Backups tab. So the page says which is which, in those words, with
 * a door to the other one.
 */
export default function Backup() {
  const { servers, backups, system } = useStore();
  const newest = [...backups].sort((a, b) => b.createdAt - a.createdAt)[0];

  return (
    <>
      <TopBar
        title="Backup & migrate"
        sub="Save what ASMS knows, or move the whole setup to another PC"
      />

      <div className="content content-narrow stack">
        <Callout tone="warn" title="Two different kinds of backup — you probably want both">
          The file on this page holds your <strong>configuration</strong>: servers, ports, passwords, mods, schedules and
          settings. It does <strong>not</strong> hold your world. Save games are backed up separately, per server, as zips —
          those are the ones that undo a bad night.
        </Callout>

        <BackupMigrate />

        <div className="card">
          <div className="card-head">
            <Icon.Archive />
            <h3>World save backups</h3>
            <Badge>{backups.length}</Badge>
            <div className="spacer" />
            <span className="card-hint">Per server, on its Backups tab</span>
          </div>
          <div className="card-body stack">
            <span className="small dim">
              A world backup is a zip of the save folder — your bases, tames and players. Take one before a settings
              experiment, a mod change or an update. ASMS can also take them on a schedule and delete the oldest
              automatically.
            </span>

            {servers.length === 0 ? (
              <Empty
                icon="📦"
                title="No servers to back up yet"
                body="Once you create a server, its Backups tab is where world zips are taken, restored and downloaded."
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Server</th>
                      <th style={{ width: 110 }}>Backups</th>
                      <th style={{ width: 190 }}>Most recent</th>
                      <th className="right" style={{ width: 190 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map((server) => {
                      const mine = backups.filter((b) => b.serverId === server.id);
                      const latest = [...mine].sort((a, b) => b.createdAt - a.createdAt)[0];
                      return (
                        <tr key={server.id}>
                          <td className="strong">
                            {server.name} <span className="faint small">{server.map}</span>
                          </td>
                          <td className="num">{mine.length || <span className="faint">none</span>}</td>
                          <td className="dim small">{latest ? dateTime(latest.createdAt) : 'never backed up'}</td>
                          <td className="right">
                            <Link className="btn btn-sm" to={`/servers/${server.id}/backups`}>
                              Open Backups <Icon.Chevron size={13} />
                            </Link>
                            <Link className="btn btn-sm btn-ghost" to={`/servers/${server.id}/schedule`}>
                              Schedule one
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card-foot">
            <span className="card-hint">
              {newest ? `Newest world backup anywhere: ${dateTime(newest.createdAt)}.` : 'No world backups taken yet.'} Zips
              live under {system?.dataDir ? <span className="mono">the backup folder in Settings</span> : 'your backup folder'}.
            </span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon.Compass />
            <h3>Moving ASMS to another PC</h3>
            <div className="spacer" />
            <span className="card-hint">In order, start to finish</span>
          </div>
          <div className="card-body">
            <ol className="steps-list">
              <li>
                <strong>Stop every server here.</strong> ARK writes the world on shutdown — copying a save from a running
                server gets you the version from whenever it last saved, not the version you can see.
              </li>
              <li>
                <strong>Export everything</strong> with the button above, with passwords included. Put the file somewhere the
                new machine can read.
              </li>
              <li>
                <strong>Copy the save folders across</strong> if you want the worlds too — each server's{' '}
                <span className="mono">ShooterGame/Saved</span> folder, and your backup folder if you want its history. These
                are gigabytes; they are not in the export file.
              </li>
              <li>
                <strong>Install ASMS on the new PC</strong> and let it fetch SteamCMD.
              </li>
              <li>
                <strong>Restore the file</strong> here, ticking <span className="strong">This is a different PC</span> so
                install paths are rewritten to folders that exist on the new machine.
              </li>
              <li>
                <strong>Download the game files</strong> for each server — about 30 GB each, and the one thing no backup can
                carry. Then drop the save folders in and start up.
              </li>
            </ol>
            <Callout tone="ok" title="Nothing is deleted by a restore">
              Restoring rewrites what ASMS knows about servers. It never touches game installs, save games or backup zips on
              disk — worst case you end up pointing at the wrong folder and can fix the path afterwards.
            </Callout>
          </div>
        </div>

        <div className="card card-pad row row-wrap" style={{ gap: 10 }}>
          <Icon.Book />
          <span className="small dim" style={{ flex: 1, minWidth: 220 }}>
            The setup guide covers backups, scheduled restarts and what to do when a world will not load.
          </span>
          <Link className="btn btn-sm" to="/guide#care">
            Read that section
          </Link>
        </div>
      </div>
    </>
  );
}

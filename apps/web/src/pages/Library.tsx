import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useAction } from '../lib/store';
import { api } from '../lib/api';
import { TopBar } from '../components/Shell';
import { Button, Badge, Empty, Field, CopyButton, SearchInput, Callout, ExternalLink } from '../components/ui';
import { Icon } from '../components/Icons';
import { Help } from '../components/Tooltip';
import { modLabel, modLink, modSearchLink, parseModList } from '../lib/mods';
import { matches } from '../lib/search';
import { ModSources } from '../components/ModSources';
import { randomClusterId } from '../lib/cluster';
import type { Library as LibraryShape, SavedCluster, SavedMod } from '../lib/types';

/**
 * The things you re-use across servers, kept in one place: the mods you always
 * install, and the cluster IDs your servers share. Neither belongs to a server
 * — the point is that the *next* server is set up from a list of ticks instead
 * of a dig through Discord for six project IDs.
 */
export default function Library() {
  return (
    <>
      <TopBar
        title="Mod & cluster library"
        sub="Saved mods and cluster IDs, ready to drop into any server"
      />
      <div className="content stack">
        <Callout tone="info" title="Nothing here is switched on anywhere">
          This is a shelf, not a server. Mods and cluster IDs kept here are offered to you when you create a server or edit
          one — they change nothing on their own.
        </Callout>
        <ModLibrary />
        <ModSources />
        <ClusterLibrary />
      </div>
    </>
  );
}

// -------------------------------------------------------------------- mods

function ModLibrary() {
  const { library, toast } = useStore();
  const [busy, run] = useAction();
  const [entry, setEntry] = useState('');
  const [find, setFind] = useState('');

  const mods = library.mods;
  const shown = mods.filter((mod) => matches(find, mod.name, mod.id, mod.author, mod.note));
  const nameNotId = entry.trim().length > 2 && !parseModList(entry).length;

  const add = () => {
    const parsed = parseModList(entry);
    if (!parsed.length) {
      toast('warn', 'Nothing to add', 'Paste a project ID, or a Name,ID,URL line.');
      return;
    }
    void run(async () => {
      await api.post<LibraryShape>('/library/mods', { mods: parsed });
      setEntry('');
    }, `Saved ${parsed.length} mod${parsed.length === 1 ? '' : 's'}`);
  };

  const patch = (id: string, change: Partial<SavedMod>) =>
    void run(() =>
      api.put<LibraryShape>('/library/mods', {
        mods: mods.map((mod) => (mod.id === id ? { ...mod, ...change } : mod)),
      }),
    );

  const remove = (mod: SavedMod) =>
    void run(() => api.del<LibraryShape>(`/library/mods/${mod.id}`), `${modLabel(mod)} removed`);

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Package />
        <h3>Saved mods</h3>
        <Help
          title="Why keep a list here"
          body="A server's mod list is a load order — it belongs to that server. This is the shelf you pick from: every mod you keep coming back to, with its name and author attached, so the next server is a few ticks rather than six project IDs retyped from memory."
        />
        <Badge>{mods.length}</Badge>
        <div className="spacer" />
        {mods.length > 5 ? (
          <SearchInput value={find} onChange={setFind} width={240} placeholder="Find a saved mod…" hint={find ? `${shown.length} of ${mods.length}` : undefined} />
        ) : null}
        {mods.length ? <CopyButton text={mods.map((m) => m.id).join(', ')} label="Copy IDs" /> : null}
      </div>

      <div className="card-body stack">
        <Field
          label="Save a mod by CurseForge project ID"
          help="One ID, several at once, or Name,ID,URL rows separated by semicolons."
        >
          <div className="input-group">
            <input
              className="input input-mono"
              value={entry}
              placeholder="893657   or   Better Breeding,941697,https://..."
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <Button variant="primary" busy={busy} onClick={add}>
              <Icon.Plus /> Save
            </Button>
          </div>
          {nameNotId ? (
            <div className="row small" style={{ marginTop: 8, gap: 8 }}>
              <Icon.Search size={13} className="dim" />
              <span className="dim">
                ARK identifies mods by number, not by name.{' '}
                <ExternalLink href={modSearchLink(entry)} className="strong">
                  Search CurseForge for “{entry.trim()}”
                </ExternalLink>{' '}
                and copy the number out of the URL.
              </span>
            </div>
          ) : null}
        </Field>

        {mods.length === 0 ? (
          <Empty
            icon="🧩"
            title="Nothing saved yet"
            body="Paste a CurseForge project ID above, or open a server's Mods tab and use Save to library — the names and authors you have already filled in come across with it."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mod</th>
                  <th style={{ width: 130 }}>Project ID</th>
                  <th style={{ width: 150 }}>Author</th>
                  <th>Note</th>
                  <th className="right" style={{ width: 56 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((mod) => (
                  <tr key={mod.id}>
                    <td>
                      <input
                        className="input"
                        defaultValue={mod.name}
                        placeholder={`Mod ${mod.id}`}
                        onBlur={(e) => e.target.value !== mod.name && patch(mod.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="mono">
                      <a href={modLink(mod)} target="_blank" rel="noreferrer noopener" title={modLabel(mod)}>
                        {mod.id} &#8599;
                      </a>
                    </td>
                    <td>
                      <input
                        className="input"
                        defaultValue={mod.author}
                        placeholder="-"
                        onBlur={(e) => e.target.value !== mod.author && patch(mod.id, { author: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        defaultValue={mod.note}
                        placeholder="what it does, who asked for it"
                        onBlur={(e) => e.target.value !== mod.note && patch(mod.id, { note: e.target.value })}
                      />
                    </td>
                    <td className="right">
                      <Button size="sm" variant="danger" busy={busy} onClick={() => remove(mod)} title="Remove from library">
                        <Icon.Trash size={13} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {find && mods.length && !shown.length ? (
          <span className="small faint">No saved mod matches “{find}”.</span>
        ) : null}
      </div>

      <div className="card-foot">
        <span className="card-hint">
          Saving a mod here changes nothing on any server — it is offered when you create one, and on any server's Mods tab.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- clusters

function ClusterLibrary() {
  const { library, servers, toast } = useStore();
  const [busy, run] = useAction();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [find, setFind] = useState('');

  /** Live membership, so a saved ID is never just an unexplained string. */
  const membersOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const server of servers) {
      if (!server.clusterId.trim()) continue;
      map.set(server.clusterId, [...(map.get(server.clusterId) ?? []), server.name]);
    }
    return map;
  }, [servers]);

  const clusters = library.clusters;

  const add = () => {
    const wanted = id.trim();
    if (!wanted) {
      toast('warn', 'Give it an ID', 'Any short string — every server in the cluster must use exactly the same one.');
      return;
    }
    void run(async () => {
      await api.post<LibraryShape>('/library/clusters', { clusters: [{ id: wanted, name: name.trim() }] });
      setId('');
      setName('');
    }, `Cluster ${wanted} saved`);
  };

  const patch = (clusterId: string, change: Partial<SavedCluster>) =>
    void run(() =>
      api.put<LibraryShape>('/library/clusters', {
        clusters: clusters.map((cluster) => (cluster.id === clusterId ? { ...cluster, ...change } : cluster)),
      }),
    );

  const remove = (cluster: SavedCluster) =>
    void run(() => api.del<LibraryShape>(`/library/clusters/${cluster.id}`), `${cluster.id} removed`);

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Cluster />
        <h3>Cluster IDs</h3>
        <Help
          title="Why these are worth saving"
          body="Servers sharing a cluster ID share an upload/download bank, so players and dinos move between maps. They only share it if the string matches exactly — one typo and you get two clusters that look like one. Every ID a server uses is recorded here automatically."
        />
        <Badge>{clusters.length}</Badge>
        <div className="spacer" />
        {clusters.length > 5 ? (
          <SearchInput value={find} onChange={setFind} width={220} placeholder="Find a cluster ID…" />
        ) : null}
        <Link className="btn btn-sm btn-ghost" to="/clusters">
          See live clusters <Icon.Chevron size={13} />
        </Link>
      </div>

      <div className="card-body stack">
        <Field
          label="Save a cluster ID"
          help="Letters, numbers, dots, dashes and underscores. Saving one before any server uses it is fine."
        >
          <div className="input-group">
            <input
              className="input input-mono"
              value={id}
              placeholder="ark-…"
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <Button title="Generate a cluster ID nobody else is using" onClick={() => setId(randomClusterId())}>
              <Icon.Dice size={14} /> Random
            </Button>
            <input
              className="input"
              value={name}
              placeholder="What is it? (optional)"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <Button variant="primary" busy={busy} onClick={add}>
              <Icon.Plus /> Save
            </Button>
          </div>
        </Field>

        {clusters.length === 0 ? (
          <Empty
            icon="🔗"
            title="No cluster IDs saved"
            body="Give one to a server and it lands here on its own. Save one up front if you already know what the next cluster will be called."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Cluster ID</th>
                  <th>What it is</th>
                  <th style={{ width: 220 }}>Servers using it</th>
                  <th className="right" style={{ width: 56 }} />
                </tr>
              </thead>
              <tbody>
                {clusters
                  .filter((cluster) => matches(find, cluster.id, cluster.name, cluster.note))
                  .map((cluster) => {
                  const members = membersOf.get(cluster.id) ?? [];
                  return (
                    <tr key={cluster.id}>
                      <td className="mono strong">{cluster.id}</td>
                      <td>
                        <input
                          className="input"
                          defaultValue={cluster.name}
                          placeholder="what this cluster is for"
                          onBlur={(e) => e.target.value !== cluster.name && patch(cluster.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="small">
                        {members.length ? (
                          <span className="truncate" title={members.join(', ')}>
                            {members.join(', ')}
                          </span>
                        ) : (
                          <span className="faint">none yet</span>
                        )}
                      </td>
                      <td className="right">
                        <Button size="sm" variant="danger" busy={busy} onClick={() => remove(cluster)} title="Forget this ID">
                          <Icon.Trash size={13} />
                        </Button>
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
          Removing an ID here only forgets the shortcut — servers already using it keep it, and keep transferring.
        </span>
      </div>
    </div>
  );
}

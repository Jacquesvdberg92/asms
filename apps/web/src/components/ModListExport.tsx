import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Badge, Button, CopyButton, Empty, Field, Toggle } from './ui';
import { Icon } from './Icons';
import { Help } from './Tooltip';
import { downloadText } from '../lib/setups';
import { MOD_LIST_FORMATS, buildModList, flattenGroups, modListFileName } from '../lib/modlist';
import type { ModListFormat, ModGroup } from '../lib/modlist';
import type { ModEntry } from '../lib/types';

/**
 * The mod list, on its own, without the rest of the backup.
 *
 * The configuration file above carries these mods already — but it carries
 * them alongside every password on the machine, which makes it exactly the
 * wrong thing to hand a co-admin or paste in Discord. This card writes the
 * same list out with nothing else in it: no passwords, no ports, no paths.
 *
 * The default format is the one ASMS reads back, so "send me your mod list"
 * and "put my mod list on the new server" are the same file.
 */
export function ModListExport() {
  const { servers, library } = useStore();
  const [scope, setScope] = useState('all');
  const [format, setFormat] = useState<ModListFormat>('asms');
  const [enabledOnly, setEnabledOnly] = useState(false);

  const withMods = servers.filter((server) => server.mods.length > 0);
  const sources = withMods.length + (library.mods.length ? 1 : 0);

  /** What the chosen scope covers, before the switched-off filter. */
  const groups = useMemo<ModGroup[]>(() => {
    const out: ModGroup[] = [];
    for (const server of servers) {
      if (scope !== 'all' && scope !== server.id) continue;
      if (!server.mods.length) continue;
      out.push({ title: server.name, sub: server.map, ordered: true, mods: server.mods });
    }
    if ((scope === 'all' || scope === 'library') && library.mods.length) {
      out.push({
        title: 'Mod library',
        sub: 'kept for re-use',
        ordered: false,
        // A saved mod has no on/off — the shelf does not run anything.
        mods: library.mods.map<ModEntry>((mod) => ({
          id: mod.id,
          name: mod.name,
          author: mod.author,
          url: mod.url,
          enabled: true,
        })),
      });
    }
    return out;
  }, [scope, servers, library.mods]);

  const off = flattenGroups(groups).filter((mod) => !mod.enabled).length;

  const chosen = useMemo<ModGroup[]>(
    () =>
      enabledOnly
        ? groups.map((group) => ({ ...group, mods: group.mods.filter((mod) => mod.enabled) })).filter((g) => g.mods.length)
        : groups,
    [groups, enabledOnly],
  );

  const total = flattenGroups(chosen).length;
  const text = useMemo(() => buildModList(chosen, format), [chosen, format]);

  const scopeLabel =
    scope === 'all' ? 'everything' : scope === 'library' ? 'library' : servers.find((s) => s.id === scope)?.name ?? 'server';

  if (!sources) {
    return (
      <div className="card">
        <div className="card-head">
          <Icon.Package />
          <h3>Just the mod list</h3>
          <div className="spacer" />
          <span className="card-hint">Nothing to export yet</span>
        </div>
        <div className="card-body">
          <Empty
            icon="🧩"
            title="No mods anywhere yet"
            body="Once a server has mods, or you have saved some to the library, the list can be exported here on its own — without the passwords the file above carries."
            action={
              <Link className="btn btn-sm" to="/library">
                Open the mod library
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Package />
        <h3>Just the mod list</h3>
        <Help
          title="The list on its own"
          body="Mods are in the backup file above too, but that file also holds every password on this machine. This one holds nothing but mods — safe to send to a co-admin, post in Discord, or keep beside your notes."
        />
        <Badge>{total}</Badge>
        <div className="spacer" />
        <span className="card-hint">No passwords, no paths</span>
      </div>

      <div className="card-body stack">
        <div className="row row-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
          <Field label="Which mods">
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} style={{ minWidth: 220 }}>
              <option value="all">Everything — every server and the library</option>
              {library.mods.length ? <option value="library">Mod library only ({library.mods.length})</option> : null}
              {withMods.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} — {server.map} ({server.mods.length})
                </option>
              ))}
            </select>
          </Field>

          <Field label="As what">
            <select
              className="select"
              value={format}
              onChange={(e) => setFormat(e.target.value as ModListFormat)}
              style={{ minWidth: 200 }}
            >
              {MOD_LIST_FORMATS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <span className="small dim">{MOD_LIST_FORMATS.find((option) => option.id === format)?.help}</span>

        {off > 0 ? (
          <Toggle
            checked={enabledOnly}
            onChange={setEnabledOnly}
            title={off === 1 ? 'Leave out the mod that is switched off' : `Leave out the ${off} mods that are switched off`}
            help={
              format === 'markdown'
                ? 'Markdown keeps them either way if you leave this off, marked as switched off so nothing is lost.'
                : 'This format has no on/off field, so a switched-off mod left in the file comes back switched on wherever it is pasted.'
            }
          />
        ) : null}

        {chosen.length > 1 ? (
          <span className="small faint">
            <Icon.Info size={12} /> Merging {chosen.length} lists into one: every mod appears once, in the order the first
            list had it. Pick a single server above if the load order matters.
          </span>
        ) : null}

        {total ? (
          <pre className="code" style={{ maxHeight: 220, overflowY: 'auto', margin: 0 }}>
            {text}
          </pre>
        ) : (
          <span className="small dim">Every mod in this selection is switched off, so the file would be empty.</span>
        )}
      </div>

      <div className="card-foot row row-wrap" style={{ gap: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={!total}
          onClick={() => downloadText(modListFileName(scopeLabel, format), text)}
        >
          <Icon.Download size={13} /> Download the list
        </Button>
        <CopyButton text={text} label="Copy it instead" />
        <div className="spacer" />
        <span className="card-hint">
          {total} mod{total === 1 ? '' : 's'} · {modListFileName(scopeLabel, format)}
        </span>
      </div>
    </div>
  );
}

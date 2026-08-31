import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { Icon } from './Icons';
import { rank } from '../lib/search';
import { modLabel, modLink, modSearchLink, looksLikeModId, CURSEFORGE_ASA } from '../lib/mods';

interface Entry {
  id: string;
  label: string;
  group: string;
  /** Right-hand context: which server, which file, what it costs you. */
  hint?: string;
  /** Words that should find this entry but do not appear in its name. */
  keywords?: string;
  icon?: keyof typeof Icon;
  /** Set for anything that leaves ASMS, so the row can say so. */
  href?: string;
  run?: () => void;
}

const RECENT_KEY = 'asms.search.recent';
const LAST_SERVER_KEY = 'asms.lastServer';

/** Groups shown, in this order, when the box is empty. */
const DEFAULT_GROUPS = ['Servers', 'Do something', 'Pages', 'Help'];

const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/**
 * One box for the whole app: pages, servers and their tabs, every action, every
 * game setting and launch flag in the catalog, RCON commands, your saved mods
 * and setups, guide sections - and, when nothing here matches, the places on
 * the web where the answer actually lives.
 *
 * The reason it reaches so far is that most of ASMS is three clicks deep by
 * necessity: eight tabs per server times however many servers, and 200-odd
 * settings behind a group filter. Typing "taming" should not require knowing
 * that taming rates live under Rates on a tab called Settings.
 */
export function CommandPalette() {
  const { servers, runtimes, catalog, library, setups, backups, toast } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Which server a setting or a console command should open on. The one you
  // are looking at, else the one you looked at last, else the only sensible
  // guess - and the row always says which, so it is never a surprise.
  const onServer = /^\/servers\/([^/]+)/.exec(location.pathname)?.[1];
  useEffect(() => {
    if (onServer) localStorage.setItem(LAST_SERVER_KEY, onServer);
  }, [onServer]);
  const target = useMemo(() => {
    const wanted = onServer ?? localStorage.getItem(LAST_SERVER_KEY) ?? '';
    return servers.find((s) => s.id === wanted) ?? servers[0];
  }, [servers, onServer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // "/" is the other search key people try, but only when they are not
      // already typing into something.
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('asms:palette', onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('asms:palette', onEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const go = (path: string) => () => navigate(path);
    const list: Entry[] = [];

    // ------------------------------------------------------------- pages
    list.push(
      { id: 'p-dash', label: 'Dashboard', group: 'Pages', icon: 'Dashboard', hint: 'every server at a glance', keywords: 'home overview players online cpu memory chart', run: go('/') },
      { id: 'p-setups', label: 'Presets & setups', group: 'Pages', icon: 'Layers', hint: 'play styles, saved configs', keywords: 'creative easy medium hard boosted vanilla rates import export share bundle', run: go('/setups') },
      { id: 'p-library', label: 'Mod & cluster library', group: 'Pages', icon: 'Package', hint: 'saved mods, cluster IDs', keywords: 'mods curseforge project id cluster shelf saved', run: go('/library') },
      { id: 'p-clusters', label: 'Clusters', group: 'Pages', icon: 'Cluster', hint: 'who shares transfers', keywords: 'transfer upload download bank cross ark obelisk', run: go('/clusters') },
      { id: 'p-settings', label: 'Settings', group: 'Pages', icon: 'Settings', hint: 'ASMS itself', keywords: 'folders paths steamcmd password port accent notifications discord', run: go('/settings') },
      { id: 'p-backup', label: 'Backup & migrate', group: 'Pages', icon: 'Archive', hint: 'export everything, move PC', keywords: 'export import archive restore move new computer transfer json migrate reinstall', run: go('/backup') },
      { id: 'p-guide', label: 'Setup guide', group: 'Pages', icon: 'Book', hint: 'the whole manual', keywords: 'help how to tutorial manual first time beginner', run: go('/guide') },
      { id: 'p-new', label: 'Add a server', group: 'Pages', icon: 'Plus', hint: 'the create wizard', keywords: 'new create make install map', run: go('/servers/new') },
    );

    // ---------------------------------------------------- global actions
    list.push(
      {
        id: 'a-updates',
        label: 'Check Steam for a new build',
        group: 'Do something',
        icon: 'Refresh',
        hint: 'installs nothing',
        keywords: 'update version patch build steam',
        run: () => {
          void api
            .post<{ latest: string | null }>('/system/check-updates')
            .then((r) => toast('info', r.latest ? `Steam is on build ${r.latest}` : 'Could not reach Steam'))
            .catch(() => toast('error', 'Update check failed'));
        },
      },
      { id: 'a-export', label: 'Export everything to a file', group: 'Do something', icon: 'Download', hint: 'servers, mods, schedules, settings', keywords: 'backup archive save migrate move copy', run: go('/backup') },
      { id: 'a-restore', label: 'Restore from a backup file', group: 'Do something', icon: 'Upload', hint: 'reads an .asms-archive.json', keywords: 'import recover migrate move new pc', run: go('/backup') },
    );

    // ------------------------------------------------- servers and tabs
    const TABS: Array<[string, string, string]> = [
      ['', 'Overview', 'status launch command ports firewall install update disk'],
      ['console', 'Console', 'rcon command broadcast saveworld chat output log live'],
      ['players', 'Players', 'online kick ban whitelist steam id who'],
      ['settings', 'Settings', 'ini rates rules launch flags passwords ports map name'],
      ['mods', 'Mods', 'curseforge project id load order automanagedmods'],
      ['backups', 'Backups', 'save world zip restore snapshot rollback'],
      ['schedule', 'Schedule', 'cron restart nightly automatic task countdown'],
      ['logs', 'Logs', 'shootergame log crash error file tail'],
    ];

    for (const server of servers) {
      const rt = runtimes[server.id];
      const live = rt?.state === 'running' || rt?.state === 'starting';
      for (const [tab, label, words] of TABS) {
        list.push({
          id: `s-${server.id}-${tab || 'overview'}`,
          label: `${server.name} · ${label}`,
          group: 'Servers',
          icon: 'Server',
          hint: server.map,
          keywords: `${words} ${server.map} ${server.sessionName}`,
          run: go(`/servers/${server.id}${tab ? `/${tab}` : ''}`),
        });
      }
      list.push({
        id: `a-${server.id}-power`,
        label: live ? `Stop ${server.name}` : `Start ${server.name}`,
        group: 'Do something',
        icon: live ? 'Stop' : 'Play',
        hint: live ? 'kicks everyone on it' : `${server.map}, port ${server.port}`,
        keywords: 'power launch boot shutdown quit',
        run: () => {
          void api
            .post(`/servers/${server.id}/${live ? 'stop' : 'start'}`)
            .then(() => toast('info', live ? `Stopping ${server.name}…` : `Starting ${server.name}…`))
            .catch((err) => toast('error', 'That did not work', err.message));
        },
      });
      if (live) {
        list.push(
          {
            id: `a-${server.id}-save`,
            label: `Save the world on ${server.name}`,
            group: 'Do something',
            icon: 'Save',
            hint: 'forces a save right now',
            keywords: 'saveworld persist write disk',
            run: () => {
              void api
                .post(`/servers/${server.id}/save`)
                .then(() => toast('success', 'World saved'))
                .catch((err) => toast('error', 'Save failed', err.message));
            },
          },
          {
            id: `a-${server.id}-restart`,
            label: `Restart ${server.name}`,
            group: 'Do something',
            icon: 'Restart',
            hint: 'opens the countdown dialog',
            keywords: 'reboot bounce apply changes countdown warn',
            run: go(`/servers/${server.id}`),
          },
        );
      }
      list.push({
        id: `a-${server.id}-backup`,
        label: `Back up ${server.name}'s world`,
        group: 'Do something',
        icon: 'Archive',
        hint: 'zips the save folder',
        keywords: 'snapshot save zip protect before',
        run: () => {
          void api
            .post(`/servers/${server.id}/backup`)
            .then(() => toast('success', 'Backup started'))
            .catch((err) => toast('error', 'Backup failed', err.message));
        },
      });
    }

    // -------------------------------------------------- catalog settings
    if (target) {
      for (const def of catalog?.settings ?? []) {
        list.push({
          id: `g-${def.file}-${def.key}`,
          label: def.label,
          group: 'Game settings',
          icon: 'Sliders',
          hint: `${target.name} · ${def.group}`,
          keywords: `${def.key} ${def.group} ${def.help ?? ''} ${def.file === 'gus' ? 'GameUserSettings' : 'Game'}.ini ini rate multiplier`,
          run: go(`/servers/${target.id}/settings?sub=game&find=${encodeURIComponent(def.key)}`),
        });
      }
      for (const flag of catalog?.launchFlags ?? []) {
        list.push({
          id: `f-${flag.key}`,
          label: flag.label,
          group: 'Launch flags',
          icon: 'Bolt',
          hint: `${target.name} · ${flag.arg}`,
          keywords: `${flag.arg} ${flag.group} ${flag.help} command line switch argument`,
          run: go(`/servers/${target.id}/settings?sub=server&flag=${encodeURIComponent(flag.key)}`),
        });
      }
      for (const cmd of catalog?.rconCommands ?? []) {
        list.push({
          id: `r-${cmd.cmd}`,
          label: cmd.cmd,
          group: 'Console commands',
          icon: 'Terminal',
          hint: `${target.name} · ${cmd.danger ? 'careful — ' : ''}${cmd.help}`,
          keywords: `rcon console ${cmd.args ?? ''} ${cmd.help}`,
          run: go(`/servers/${target.id}/console?cmd=${encodeURIComponent(cmd.cmd + (cmd.args ? ' ' : ''))}`),
        });
      }
      for (const map of catalog?.maps ?? []) {
        list.push({
          id: `m-${map.code}`,
          label: `New server on ${map.name}`,
          group: 'Do something',
          icon: 'Globe',
          hint: map.code,
          keywords: `map create ${map.code} ${map.official ? 'official' : 'mod map'}`,
          run: go('/servers/new'),
        });
      }
    }

    // ------------------------------------------------ your own saved stuff
    for (const mod of library.mods) {
      list.push({
        id: `lm-${mod.id}`,
        label: modLabel(mod),
        group: 'Your mods',
        icon: 'Package',
        hint: `project ${mod.id} — opens CurseForge`,
        keywords: `${mod.id} ${mod.author} ${mod.note ?? ''} curseforge mod`,
        href: modLink(mod),
      });
    }
    for (const cluster of library.clusters) {
      list.push({
        id: `lc-${cluster.id}`,
        label: cluster.name || cluster.id,
        group: 'Clusters & setups',
        icon: 'Cluster',
        hint: `cluster ${cluster.id}`,
        keywords: `${cluster.id} transfer shared`,
        run: go('/clusters'),
      });
    }
    for (const setup of setups) {
      list.push({
        id: `su-${setup.id}`,
        label: setup.bundle.name,
        group: 'Clusters & setups',
        icon: 'Layers',
        hint: 'saved setup',
        keywords: `${setup.bundle.description} ${setup.bundle.map} bundle config apply share`,
        run: go('/setups'),
      });
    }
    if (backups.length) {
      list.push({
        id: 'a-backups',
        label: `Browse world backups (${backups.length})`,
        group: 'Do something',
        icon: 'Archive',
        hint: 'per server, on its Backups tab',
        keywords: 'restore rollback zip save game',
        run: go(target ? `/servers/${target.id}/backups` : '/'),
      });
    }

    // ------------------------------------------------------ guide sections
    const GUIDE: Array<[string, string, string]> = [
      ['before', 'What you need before you start', 'disk ram hardware requirements windows'],
      ['steamcmd', 'Installing SteamCMD', 'valve downloader install tool'],
      ['create', 'Creating a server', 'wizard new first'],
      ['files', 'Downloading the game files', '30gb install steam download slow'],
      ['ports', 'Ports & firewall', 'port forward router nat upnp 7777 27015 firewall unreachable cannot find server'],
      ['join', 'Starting up & joining', 'connect open ip friends unofficial list'],
      ['settings', 'Rates & rules', 'ini taming harvest xp multiplier difficulty'],
      ['setups', 'Presets & setups', 'share bundle apply'],
      ['mods', 'Mods', 'curseforge project id load order broken not loading'],
      ['care', 'Backups & restarts', 'schedule nightly cron rollback'],
      ['cluster', 'Clusters', 'transfer between maps upload download'],
      ['security', 'Security', 'password vpn tailscale expose internet safe'],
      ['trouble', 'When things break', 'crash troubleshoot error not starting help fix'],
      ['docker', 'Running ASMS in Docker', 'container compose image volume linux daemon deploy publish ports proton wine headless nas server'],
    ];
    for (const [anchor, label, words] of GUIDE) {
      list.push({
        id: `gd-${anchor}`,
        label,
        group: 'Help',
        icon: 'Book',
        hint: 'setup guide',
        keywords: `guide help how to ${words}`,
        run: go(`/guide#${anchor}`),
      });
    }

    // --------------------------------------------------- settings sections
    const SETTINGS_SECTIONS: Array<[string, string, string]> = [
      ['folders', 'Folders — where installs and backups go', 'path install root backup cluster steamcmd drive'],
      ['maintenance', 'Maintenance — update checks and retention', 'interval how many backups keep delete old'],
      ['startup', 'Starting up — what comes back after a reboot', 'autostart boot power cut restart windows service'],
      ['launching', 'Launching — Proton or Wine wrapper', 'linux docker proton wine command'],
      ['access', 'Access — who can reach this dashboard', 'password bind host port network phone lan remote vpn security'],
      ['notifications', 'Notifications — Discord webhook', 'discord webhook alert message crash'],
      ['appearance', 'Appearance — accent colour', 'theme colour color dark'],
      ['machine', 'This machine — CPU, RAM, SteamCMD', 'host system info hardware data folder'],
    ];
    for (const [anchor, label, words] of SETTINGS_SECTIONS) {
      list.push({
        id: `st-${anchor}`,
        label,
        group: 'Pages',
        icon: 'Settings',
        hint: 'settings',
        keywords: words,
        run: go(`/settings#${anchor}`),
      });
    }

    // -------------------------------------------------------- out on the web
    list.push(
      { id: 'w-cf', label: 'Browse ASA mods on CurseForge', group: 'Help', icon: 'Compass', hint: 'the only mod source ARK uses', keywords: 'find mods where get download workshop', href: `${CURSEFORGE_ASA}/mods` },
      { id: 'w-cf-pop', label: 'Most popular ASA mods', group: 'Help', icon: 'Compass', hint: 'sorted by downloads', keywords: 'find mods best top recommended', href: `${CURSEFORGE_ASA}/mods?sortBy=popularity` },
      { id: 'w-wiki', label: 'ARK Wiki', group: 'Help', icon: 'Book', hint: 'creatures, items, engrams', keywords: 'wiki reference dino item spawn code', href: 'https://ark.wiki.gg/' },
    );

    return list;
  }, [servers, runtimes, catalog, library, setups, backups, target, navigate, toast]);

  const typed = query.trim();

  // Two lists that behave differently on purpose: an empty box is a menu, so it
  // stays grouped and predictable; a typed box is a ranking, so it goes flat
  // and puts the best answer under the cursor.
  const results = useMemo(() => {
    if (!typed) {
      const recentEntries = recent.map((id) => entries.find((e) => e.id === id)).filter(Boolean) as Entry[];
      const rest = DEFAULT_GROUPS.flatMap((group) =>
        entries.filter((e) => e.group === group && !recent.includes(e.id)).slice(0, group === 'Servers' ? 6 : 5),
      );
      return [...recentEntries.map((e) => ({ ...e, group: 'Recent' })), ...rest];
    }
    const ranked = rank(typed, entries, (e) => ({ label: e.label, keywords: `${e.keywords ?? ''} ${e.hint ?? ''}` }));
    const web: Entry[] = [
      {
        id: 'w-search-cf',
        label: `Search CurseForge for “${typed}”`,
        group: 'On the web',
        icon: 'Compass',
        hint: 'find a mod by name',
        href: modSearchLink(typed),
      },
      ...(looksLikeModId(typed)
        ? [
            {
              id: 'w-project',
              label: `Open project ${typed} on CurseForge`,
              group: 'On the web',
              icon: 'Package' as const,
              hint: 'check an ID before you add it',
              href: `https://www.curseforge.com/projects/${typed}`,
            },
          ]
        : []),
      {
        id: 'w-search-wiki',
        label: `Look up “${typed}” on the ARK Wiki`,
        group: 'On the web',
        icon: 'Book',
        hint: 'creatures, items, spawn codes',
        href: `https://ark.wiki.gg/index.php?search=${encodeURIComponent(typed)}`,
      },
    ];
    return [...ranked.slice(0, 40), ...web];
  }, [entries, typed, recent]);

  useEffect(() => {
    const el = listRef.current?.querySelector('.palette-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  if (!open) return null;

  const choose = (entry: Entry) => {
    const next = [entry.id, ...recent.filter((id) => id !== entry.id)].slice(0, 5);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    if (entry.href) window.open(entry.href, '_blank', 'noopener,noreferrer');
    else entry.run?.();
    setOpen(false);
  };

  let lastGroup = '';

  return (
    <div className="palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Search everything">
        <div className="palette-input">
          <Icon.Search size={16} className="dim" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search servers, settings, mods, actions, help…"
            aria-label="Search everything"
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter' && results[index]) choose(results[index]);
            }}
          />
        </div>

        <div className="palette-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">Nothing in ASMS matches “{typed}”.</div>
          ) : (
            results.map((entry, i) => {
              const header = entry.group !== lastGroup && (!typed || entry.group === 'On the web') ? entry.group : null;
              lastGroup = entry.group;
              const Glyph = Icon[entry.icon ?? 'Chevron'];
              return (
                <div key={entry.id}>
                  {header ? <div className="palette-group">{header}</div> : null}
                  <button
                    className={`palette-item ${i === index ? 'active' : ''}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(entry)}
                  >
                    <Glyph size={14} />
                    <span className="truncate">{entry.label}</span>
                    {typed && entry.group !== 'On the web' ? <span className="palette-tag">{entry.group}</span> : null}
                    {entry.hint ? <span className="where truncate">{entry.hint}</span> : null}
                    {entry.href ? <Icon.External size={12} /> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          <span className="spacer" />
          <span className="faint">{target ? `settings open on ${target.name}` : 'no servers yet'}</span>
        </div>
      </div>
    </div>
  );
}

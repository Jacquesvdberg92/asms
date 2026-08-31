import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Icon } from './Icons';
import { Button } from './ui';
import { CURSEFORGE_ASA } from '../lib/mods';
import type { ServerState } from '../lib/types';

const DOT_FOR: Record<ServerState, string> = {
  running: 'dot-ok',
  starting: 'dot-warn dot-pulse',
  stopping: 'dot-warn dot-pulse',
  installing: 'dot-info dot-pulse',
  updating: 'dot-info dot-pulse',
  crashed: 'dot-bad',
  stopped: '',
};

const STATE_WORD: Record<ServerState, string> = {
  running: 'running',
  starting: 'starting up',
  stopping: 'shutting down',
  installing: 'downloading files',
  updating: 'updating',
  crashed: 'crashed',
  stopped: 'stopped',
};

interface NavEntry {
  to: string;
  name: string;
  desc: string;
  icon: keyof typeof Icon;
  end?: boolean;
  external?: boolean;
}

/**
 * Every nav item says what it is for, not only what it is called, and the
 * groups answer the question people actually arrive with: is this a thing
 * about one server, a thing I reuse, or a thing about ASMS itself? Backup &
 * migrate is a top-level item for the same reason - it was a card at the
 * bottom of a long Settings page, which is no place for the one button that
 * gets your servers back.
 */
const GROUPS: Array<{ label?: string; blurb?: string; items: NavEntry[] }> = [
  {
    items: [{ to: '/', name: 'Dashboard', desc: 'Every server at a glance', icon: 'Dashboard', end: true }],
  },
  {
    label: 'Set up once, reuse',
    blurb: 'Pieces that drop into any server',
    items: [
      { to: '/setups', name: 'Presets & setups', desc: 'Play styles & saved configs', icon: 'Layers' },
      { to: '/library', name: 'Mod & cluster library', desc: 'Mods & cluster IDs you reuse', icon: 'Package' },
      { to: '/clusters', name: 'Clusters', desc: 'Which servers share transfers', icon: 'Cluster' },
    ],
  },
  {
    label: 'ASMS itself',
    blurb: 'The manager, not any one server',
    items: [
      { to: '/settings', name: 'Settings', desc: 'Folders, access, Discord', icon: 'Settings' },
      { to: '/backup', name: 'Backup & migrate', desc: 'Export everything, move PC', icon: 'Archive' },
    ],
  },
  {
    label: 'Help',
    items: [
      { to: '/guide', name: 'Setup guide', desc: 'From nothing to friends joining', icon: 'Book' },
      {
        to: `${CURSEFORGE_ASA}/mods`,
        name: 'Find mods',
        desc: 'Browse ASA mods on CurseForge',
        icon: 'Compass',
        external: true,
      },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { servers, runtimes, connected, signOut, authRequired } = useStore();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // TopBar lives inside each page, so it asks the shell to open the drawer
  // through an event rather than threading state through every route.
  useEffect(() => {
    const onMenu = () => setOpen(true);
    window.addEventListener('asms:menu', onMenu);
    return () => window.removeEventListener('asms:menu', onMenu);
  }, []);

  const close = () => setOpen(false);
  const running = servers.filter((s) => runtimes[s.id]?.state === 'running').length;
  const players = servers.reduce((sum, s) => sum + (runtimes[s.id]?.players ?? 0), 0);

  return (
    <div className="app">
      {open ? <div className="scrim" onClick={close} /> : null}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">🦖</div>
          <div>
            <div className="brand-name">ASMS</div>
            <div className="brand-sub">Ark Server Suite</div>
          </div>
        </div>

        <button
          className="side-search"
          onClick={() => {
            close();
            openSearch();
          }}
        >
          <Icon.Search size={14} />
          <span>Search everything…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <nav className="nav">
          {GROUPS[0].items.map((item) => (
            <NavItem key={item.to} item={item} onClick={close} />
          ))}
        </nav>

        <div className="nav">
          <div className="nav-label">
            <span>Servers · {servers.length}</span>
            {servers.length ? (
              <span className="nav-blurb">
                {running} running · {players} online
              </span>
            ) : null}
          </div>
          {servers.map((server) => {
            const state = runtimes[server.id]?.state ?? 'stopped';
            const active = location.pathname.startsWith(`/servers/${server.id}`);
            return (
              <NavLink
                key={server.id}
                to={`/servers/${server.id}`}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={close}
                title={`${server.name} — ${server.map}, ${STATE_WORD[state]}`}
              >
                <Icon.Server size={15} />
                <span className="nav-item-name">{server.name}</span>
                <span className={`dot ${DOT_FOR[state]}`} aria-label={STATE_WORD[state]} />
              </NavLink>
            );
          })}
          <button
            className="nav-item nav-item-add"
            onClick={() => {
              close();
              navigate('/servers/new');
            }}
            title="Walk through creating a new ARK server"
          >
            <Icon.Plus />
            <span className="nav-item-name">Add a server</span>
          </button>
        </div>

        {GROUPS.slice(1).map((group) => (
          <div className="nav" key={group.label}>
            <div className="nav-label">
              <span>{group.label}</span>
              {group.blurb ? <span className="nav-blurb">{group.blurb}</span> : null}
            </div>
            {group.items.map((item) => (
              <NavItem key={item.to} item={item} onClick={close} />
            ))}
          </div>
        ))}

        <div className="sidebar-foot">
          <div className="row small faint" title={connected ? 'Live updates are flowing' : 'Trying to reach ASMS again'}>
            <span className={`dot ${connected ? 'dot-ok' : 'dot-bad'}`} />
            {connected ? 'Live' : 'Reconnecting…'}
          </div>
          {authRequired ? (
            <Button size="sm" variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          ) : null}
        </div>
      </aside>

      <div className="main">{children}</div>
    </div>
  );
}

function NavItem({ item, onClick }: { item: NavEntry; onClick: () => void }) {
  const Glyph = Icon[item.icon];
  const inner = (
    <>
      <Glyph size={16} />
      <span className="nav-item-text">
        <span className="nav-item-name">{item.name}</span>
        <span className="nav-item-desc">{item.desc}</span>
      </span>
      {item.external ? <Icon.External size={12} /> : null}
    </>
  );

  if (item.external) {
    return (
      <a className="nav-item nav-item-tall" href={item.to} target="_blank" rel="noreferrer noopener" title={item.to}>
        {inner}
      </a>
    );
  }
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `nav-item nav-item-tall ${isActive ? 'active' : ''}`}
      onClick={onClick}
      title={item.desc}
    >
      {inner}
    </NavLink>
  );
}

/** Open the command palette from anywhere, without importing it. */
export const openSearch = () => window.dispatchEvent(new CustomEvent('asms:palette'));

export function TopBar({
  title,
  sub,
  actions,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <button
        className="btn btn-ghost btn-icon menu-btn"
        onClick={() => window.dispatchEvent(new CustomEvent('asms:menu'))}
        aria-label="Open menu"
      >
        <Icon.Menu />
      </button>
      <div className="topbar-title">
        <h1 className="truncate">{title}</h1>
        {sub ? <span className="topbar-sub truncate">{sub}</span> : null}
      </div>
      <div className="topbar-actions">
        <button
          className="btn btn-ghost btn-icon search-btn"
          onClick={openSearch}
          aria-label="Search everything"
          title="Search everything (Ctrl K)"
        >
          <Icon.Search size={16} />
        </button>
        {actions}
      </div>
    </header>
  );
}

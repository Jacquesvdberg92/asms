import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, socketTicket } from './api';
import type {
  AppSettings,
  BackupEntry,
  Catalog,
  Library,
  SavedSetup,
  ScheduleTask,
  ServerInstance,
  ServerRuntime,
  SystemInfo,
  Toast,
  MetricPoint,
} from './types';

interface StateShape {
  ready: boolean;
  authRequired: boolean;
  /** First run: nothing is set up, and nothing works until a password is chosen. */
  setupRequired: boolean;
  signedIn: boolean;
  connected: boolean;
  /** ASMS itself is not answering — shown instead of an empty dashboard. */
  unreachable: boolean;
  servers: ServerInstance[];
  runtimes: Record<string, ServerRuntime>;
  schedules: ScheduleTask[];
  backups: BackupEntry[];
  setups: SavedSetup[];
  library: Library;
  settings: AppSettings | null;
  catalog: Catalog | null;
  system: SystemInfo | null;
  toasts: Toast[];
  /** Rolling cpu/mem/player history per server, for the trend charts. */
  metrics: Record<string, MetricPoint[]>;
}

interface StoreValue extends StateShape {
  signIn: (password: string) => Promise<void>;
  /** Answer the first-run question. An empty password means "no sign-in". */
  completeSetup: (password: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  refreshSystem: () => Promise<void>;
  runtimeOf: (id: string) => ServerRuntime | undefined;
  serverOf: (id: string) => ServerInstance | undefined;
  toast: (level: Toast['level'], title: string, body?: string) => void;
  dismissToast: (id: number) => void;
  consoleFor: (id: string) => string[];
  onConsole: (id: string, fn: (line: string) => void) => () => void;
  metricsOf: (id: string) => MetricPoint[];
}

const StoreContext = createContext<StoreValue | null>(null);

const CONSOLE_CAP = 800;

/** Console id for ASMS's own update output. Server ids are all `srv_`-prefixed. */
export const APP_UPDATE_CONSOLE = 'app:update';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StateShape>({
    ready: false,
    authRequired: false,
    setupRequired: false,
    signedIn: false,
    connected: false,
    unreachable: false,
    servers: [],
    runtimes: {},
    schedules: [],
    backups: [],
    setups: [],
    library: { mods: [], clusters: [] },
    settings: null,
    catalog: null,
    system: null,
    toasts: [],
    metrics: {},
  });

  const consoles = useRef(new Map<string, string[]>());
  const consoleSubs = useRef(new Map<string, Set<(line: string) => void>>());
  const socket = useRef<WebSocket | null>(null);
  const retry = useRef(0);
  const toastSeq = useRef(1);
  /** Throttles chart sampling: runtime pushes arrive more often than 5s. */
  const lastSample = useRef(new Map<string, number>());
  /** Read inside the socket's close handler, where state would be stale. */
  const authRequiredRef = useRef(false);
  authRequiredRef.current = state.authRequired;

  const toast = useCallback((level: Toast['level'], title: string, body?: string) => {
    const id = toastSeq.current++;
    setState((s) => ({ ...s, toasts: [...s.toasts, { id, level, title, body }] }));
    setTimeout(() => setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), level === 'error' ? 9000 : 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
  }, []);

  const pushConsole = useCallback((id: string, line: string) => {
    const buf = consoles.current.get(id) ?? [];
    buf.push(line);
    if (buf.length > CONSOLE_CAP) buf.splice(0, buf.length - CONSOLE_CAP);
    consoles.current.set(id, buf);
    consoleSubs.current.get(id)?.forEach((fn) => fn(line));
  }, []);

  const loadAll = useCallback(async () => {
    const [state1, catalog] = await Promise.all([
      api.get<{
        settings: AppSettings;
        servers: ServerInstance[];
        runtimes: ServerRuntime[];
        schedules: ScheduleTask[];
        backups: BackupEntry[];
        setups: SavedSetup[];
        library: Library;
      }>('/state'),
      api.get<Catalog>('/catalog'),
    ]);
    setState((s) => ({
      ...s,
      ready: true,
      signedIn: true,
      settings: state1.settings,
      servers: state1.servers,
      runtimes: Object.fromEntries(state1.runtimes.map((r) => [r.id, r])),
      schedules: state1.schedules,
      backups: state1.backups,
      setups: state1.setups ?? [],
      library: state1.library ?? { mods: [], clusters: [] },
      catalog,
    }));
    // Seed the charts with history the backend kept while we were away.
    void api
      .get<{ perServer: Record<string, MetricPoint[]> }>('/metrics')
      .then(({ perServer }) => setState((s) => ({ ...s, metrics: perServer })))
      .catch(() => {});
  }, []);

  const refreshSystem = useCallback(async () => {
    const system = await api.get<SystemInfo>('/system');
    setState((s) => ({ ...s, system }));
  }, []);

  const connectSocket = useCallback(async () => {
    /**
     * Detach the old socket's handlers before closing it. Without this its
     * onclose fired and scheduled *another* reconnect, so a sign-in while a
     * socket was open left two live sockets — every console line printed twice
     * and every runtime frame processed twice.
     */
    const previous = socket.current;
    socket.current = null;
    if (previous) {
      previous.onopen = null;
      previous.onclose = null;
      previous.onmessage = null;
      previous.close();
    }

    const ticket = await socketTicket();
    if (authRequiredRef.current && !ticket) return; // Signed out; nothing to connect with.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ''}`;
    const ws = new WebSocket(url);
    socket.current = ws;

    ws.onopen = () => {
      // A reconnect means we were away: hello re-seeds servers, runtimes and
      // schedules, but backups, setups and the library would stay stale.
      const reconnected = retry.current > 0;
      retry.current = 0;
      setState((s) => ({ ...s, connected: true }));
      if (reconnected) void loadAll().catch(() => {});
    };
    ws.onclose = () => {
      if (socket.current !== ws) return; // Superseded; its replacement owns the retry.
      setState((s) => ({ ...s, connected: false }));
      const delay = Math.min(10_000, 500 * 2 ** retry.current++);
      setTimeout(() => {
        if (!authRequiredRef.current || getToken() !== null) void connectSocket();
      }, delay);
    };
    ws.onmessage = (event) => {
      let type: string;
      let payload: any;
      try {
        ({ type, payload } = JSON.parse(event.data as string) as { type: string; payload: any });
      } catch {
        return; // A frame we cannot read is not worth taking the page down for.
      }
      switch (type) {
        case 'hello':
          setState((s) => ({
            ...s,
            servers: payload.servers,
            runtimes: Object.fromEntries((payload.runtimes as ServerRuntime[]).map((r) => [r.id, r])),
            schedules: payload.schedules,
            settings: payload.settings,
          }));
          break;
        case 'runtime': {
          const rt = payload as ServerRuntime;
          setState((s) => {
            const next = { ...s, runtimes: { ...s.runtimes, [rt.id]: rt } };
            const previous = lastSample.current.get(rt.id) ?? 0;
            if (Date.now() - previous >= 4500) {
              lastSample.current.set(rt.id, Date.now());
              const series = [...(s.metrics[rt.id] ?? []), { t: Date.now(), cpu: rt.cpu, memMB: rt.memMB, players: rt.players }];
              next.metrics = { ...s.metrics, [rt.id]: series.slice(-180) };
            }
            return next;
          });
          break;
        }
        case 'server:changed':
          void api.get<ServerInstance[]>('/servers').then((servers) => setState((s) => ({ ...s, servers })));
          break;
        case 'server:console':
        case 'steam:console':
          pushConsole(payload.id, payload.line);
          break;
        // ASMS updating itself has no server to belong to, so it rides the same
        // console plumbing under a reserved id that no server can be given.
        case 'app:update':
          pushConsole(APP_UPDATE_CONSOLE, payload.line);
          break;
        case 'backup:changed':
          void api
            .get<{ backups: BackupEntry[] }>('/backups')
            .then(({ backups }) => setState((s) => ({ ...s, backups })));
          break;
        case 'setup:changed':
          void api
            .get<{ setups: SavedSetup[] }>('/setups')
            .then(({ setups }) => setState((s) => ({ ...s, setups })));
          break;
        case 'library:changed':
          void api.get<Library>('/library').then((library) => setState((s) => ({ ...s, library })));
          break;
        case 'schedule:changed':
          void api
            .get<{ schedules: ScheduleTask[] }>('/schedules')
            .then(({ schedules }) => setState((s) => ({ ...s, schedules })));
          break;
        case 'notice':
          toast(payload.level, payload.title, payload.body);
          break;
        case 'console:backlog':
          consoles.current.set(payload.id, payload.lines);
          break;
        default:
          break;
      }
    };
    // loadAll is stable (useCallback with no deps); listing it would recreate
  }, [pushConsole, toast, loadAll]);

  const boot = useCallback(async () => {
    let status = { required: false, setupRequired: false };
    try {
      status = await api.get<{ required: boolean; setupRequired: boolean }>('/auth/status');
    } catch {
      // ASMS is not answering. Say so rather than spinning on "Starting ASMS…"
      // forever, and try again — it may still be coming up.
      setState((s) => ({ ...s, ready: true, signedIn: false, connected: false, unreachable: true }));
      setTimeout(() => void boot(), 3000);
      return;
    }
    setState((s) => ({ ...s, unreachable: false }));
    // Nothing else is worth asking for: every other route answers 401 until the
    // password question has been answered.
    if (status.setupRequired) {
      setState((s) => ({ ...s, ready: true, setupRequired: true, authRequired: false, signedIn: false }));
      return;
    }
    const required = status.required;
    setState((s) => ({ ...s, setupRequired: false }));
    if (required && !getToken()) {
      setState((s) => ({ ...s, ready: true, authRequired: true, signedIn: false }));
      return;
    }
    setState((s) => ({ ...s, authRequired: required }));
    try {
      await loadAll();
      await refreshSystem();
      await connectSocket();
    } catch {
      setState((s) => ({ ...s, ready: true, signedIn: false }));
    }
  }, [connectSocket, loadAll, refreshSystem]);

  useEffect(() => {
    void boot();
    // Ask what changed rather than assuming a stale session: a password cleared
    // out of asms.json puts ASMS back into first-run setup, not at a sign-in
    // screen for a password that is no longer there.
    const onUnauthorized = () => {
      setState((s) => ({ ...s, signedIn: false, authRequired: true }));
      void boot();
    };
    window.addEventListener('asms:unauthorized', onUnauthorized);
    return () => window.removeEventListener('asms:unauthorized', onUnauthorized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (password: string) => {
      const { token } = await api.post<{ token: string | null }>('/auth/login', { password });
      setToken(token);
      await loadAll();
      await refreshSystem();
      await connectSocket();
    },
    [connectSocket, loadAll, refreshSystem],
  );

  const completeSetup = useCallback(
    async (password: string) => {
      const { token } = await api.post<{ token: string | null }>('/auth/setup', { password });
      setToken(token);
      setState((s) => ({ ...s, setupRequired: false, authRequired: Boolean(token) }));
      await loadAll();
      await refreshSystem();
      await connectSocket();
    },
    [connectSocket, loadAll, refreshSystem],
  );

  const signOut = useCallback(() => {
    void api.post('/auth/logout').catch(() => {});
    setToken(null);
    socket.current?.close();
    setState((s) => ({ ...s, signedIn: false, authRequired: true }));
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      signIn,
      completeSetup,
      signOut,
      refresh: loadAll,
      refreshSystem,
      runtimeOf: (id) => state.runtimes[id],
      serverOf: (id) => state.servers.find((s) => s.id === id),
      toast,
      dismissToast,
      metricsOf: (id) => state.metrics[id] ?? [],
      consoleFor: (id) => consoles.current.get(id) ?? [],
      onConsole: (id, fn) => {
        const set = consoleSubs.current.get(id) ?? new Set();
        set.add(fn);
        consoleSubs.current.set(id, set);
        // Ask the server for backlog we may have missed while on another page.
        // Only once the socket is actually open: send() on a CONNECTING socket
        // throws, which took down the whole page for anything subscribing on
        // first paint rather than after a tab change.
        if (socket.current?.readyState === WebSocket.OPEN) {
          socket.current.send(JSON.stringify({ type: 'console:subscribe', payload: { id } }));
        }
        return () => set.delete(fn);
      },
    }),
    [state, signIn, completeSetup, signOut, loadAll, refreshSystem, toast, dismissToast],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

/** Convenience: run an async action with error toasting and a busy flag. */
export function useAction(): [boolean, <T>(fn: () => Promise<T>, successMessage?: string) => Promise<T | undefined>] {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successMessage?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        if (successMessage) toast('success', successMessage);
        return result;
      } catch (err) {
        toast('error', 'That did not work', err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return [busy, run];
}

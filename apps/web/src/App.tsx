import { Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { useStore } from './lib/store';
import { Shell } from './components/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewServer from './pages/NewServer';
import ServerDetail from './pages/ServerDetail';
import Clusters from './pages/Clusters';
import Setups from './pages/Setups';
import Library from './pages/Library';
import Settings from './pages/Settings';
import Guide from './pages/Guide';
import Backup from './pages/Backup';
import { CommandPalette } from './components/CommandPalette';

/**
 * A data router rather than <BrowserRouter>, because it is the only shape that
 * lets a panel with an unsaved draft hold a navigation up - including the back
 * button - see lib/guard.tsx.
 */
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/servers/new', element: <NewServer /> },
      { path: '/servers/:id', element: <ServerDetail /> },
      { path: '/servers/:id/:tab', element: <ServerDetail /> },
      { path: '/clusters', element: <Clusters /> },
      { path: '/setups', element: <Setups /> },
      { path: '/library', element: <Library /> },
      { path: '/settings', element: <Settings /> },
      { path: '/backup', element: <Backup /> },
      { path: '/guide', element: <Guide /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

function Layout() {
  return (
    <>
      <Shell>
        <Outlet />
      </Shell>
      <CommandPalette />
    </>
  );
}

export default function App() {
  const { ready, authRequired, signedIn, settings, toasts, dismissToast } = useStore();

  if (settings?.accent) document.documentElement.setAttribute('data-accent', settings.accent);

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="row dim">
          <span className="spinner" /> Starting ASMS…
        </div>
      </div>
    );
  }

  if (authRequired && !signedIn) {
    return (
      <>
        <Login />
        <Toasts toasts={toasts} dismiss={dismissToast} />
      </>
    );
  }

  return (
    <>
      <RouterProvider router={router} />
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </>
  );
}

function Toasts({
  toasts,
  dismiss,
}: {
  toasts: ReturnType<typeof useStore>['toasts'];
  dismiss: (id: number) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`} onClick={() => dismiss(t.id)}>
          <div className="toast-title">{t.title}</div>
          {t.body ? <div className="toast-body">{t.body}</div> : null}
        </div>
      ))}
    </div>
  );
}

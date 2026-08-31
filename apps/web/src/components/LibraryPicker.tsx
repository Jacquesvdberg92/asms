import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Button, Empty, Modal } from './ui';
import { Icon } from './Icons';
import { modLabel, modLink } from '../lib/mods';
import type { ModEntry } from '../lib/types';

/**
 * Picks mods out of the saved library. Shared by the Mods tab and the new
 * server wizard so "add my usual mods" means the same thing in both places.
 *
 * Anything already on the server is shown ticked and disabled rather than
 * hidden — seeing that four of your six are already on is the answer to the
 * question you opened this to ask.
 */
export function LibraryPicker({
  exclude,
  onAdd,
  onClose,
}: {
  /** Mod ids already present, so they cannot be added twice. */
  exclude: string[];
  onAdd: (mods: ModEntry[]) => void;
  onClose: () => void;
}) {
  const { library } = useStore();
  const available = library.mods.filter((mod) => !exclude.includes(mod.id));
  const [picked, setPicked] = useState<string[]>(() => available.map((mod) => mod.id));

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const confirm = () => {
    onAdd(
      library.mods
        .filter((mod) => picked.includes(mod.id))
        .map((mod) => ({ id: mod.id, name: mod.name, author: mod.author, url: mod.url, enabled: true })),
    );
    onClose();
  };

  return (
    <Modal
      title="Add from your library"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.length} onClick={confirm}>
            <Icon.Plus /> Add {picked.length || ''}
          </Button>
        </>
      }
    >
      {library.mods.length === 0 ? (
        <Empty
          icon="🧩"
          title="Your library is empty"
          body="Save the mods you keep coming back to and they show up here on every server you make."
          action={
            <Link className="btn" to="/library" onClick={onClose}>
              Open the library
            </Link>
          }
        />
      ) : (
        <div className="stack">
          <div className="row">
            <span className="small dim" style={{ flex: 1 }}>
              {available.length
                ? `${picked.length} of ${available.length} picked`
                : 'Every mod in your library is already on this server.'}
            </span>
            {available.length ? (
              <div className="btn-group">
                <Button size="sm" variant="ghost" onClick={() => setPicked(available.map((mod) => mod.id))}>
                  All
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
                  None
                </Button>
              </div>
            ) : null}
          </div>

          {library.mods.map((mod) => {
            const already = exclude.includes(mod.id);
            return (
              <label
                key={mod.id}
                className="row"
                style={{ gap: 10, cursor: already ? 'default' : 'pointer', opacity: already ? 0.5 : 1 }}
              >
                <input
                  type="checkbox"
                  disabled={already}
                  checked={already || picked.includes(mod.id)}
                  onChange={() => toggle(mod.id)}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="strong truncate" style={{ display: 'block' }}>
                    {modLabel(mod)}
                  </span>
                  <span className="tiny faint">
                    <span className="mono">{mod.id}</span>
                    {mod.author ? ` · ${mod.author}` : ''}
                    {mod.note ? ` · ${mod.note}` : ''}
                    {already ? ' · already on this server' : ''}
                  </span>
                </span>
                <a
                  href={modLink(mod)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="tiny"
                  onClick={(e) => e.stopPropagation()}
                >
                  open &#8599;
                </a>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

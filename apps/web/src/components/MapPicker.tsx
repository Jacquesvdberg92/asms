import { useState } from 'react';
import { mapCodeError } from '../lib/maps';
import type { MapDef } from '../lib/types';

const CUSTOM = '__custom__';

/**
 * The map dropdown, in the wizard and in every server's settings.
 *
 * The catalogue lists the maps ASMS knows a name for, and mod maps outnumber
 * those many times over - so the last entry opens a box for the code itself.
 *
 * A server already sitting on a code nobody listed - an imported archive, a
 * catalogue that has since moved on - opens in that box too, rather than
 * showing whichever map happens to be first and silently moving the server
 * there on the next save.
 */
export function MapPicker({
  maps,
  value,
  onChange,
}: {
  maps: MapDef[];
  value: string;
  onChange: (code: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  // An empty catalogue is one still loading, which is not the same as a code
  // the catalogue does not have.
  const custom = typing || (maps.length > 0 && !maps.some((m) => m.code === value));
  const note = maps.find((m) => m.code === value)?.note;
  const error = custom ? mapCodeError(value) : '';

  return (
    <>
      <select
        className="select"
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          const picked = e.target.value;
          setTyping(picked === CUSTOM);
          // Cleared rather than carried over: the old code is not a head start
          // on typing a different one, and an empty box says what to do.
          onChange(picked === CUSTOM ? '' : picked);
        }}
      >
        <optgroup label="Official">
          {maps.filter((m) => m.official).map((m) => (
            <option key={m.code} value={m.code}>
              {m.name} ({m.code})
            </option>
          ))}
        </optgroup>
        <optgroup label="Community">
          {maps.filter((m) => !m.official).map((m) => (
            <option key={m.code} value={m.code}>
              {m.name} ({m.code})
            </option>
          ))}
        </optgroup>
        <option value={CUSTOM}>Other — type a map code…</option>
      </select>
      {custom ? (
        <input
          className="input input-mono"
          value={value}
          autoFocus={typing}
          placeholder="e.g. Svartalfheim_WP"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
      {error ? <span className="field-error">{error}</span> : null}
      {custom && !error ? (
        <span className="field-help">
          The code is the mod's level name, which its mod page lists — usually ending in _WP. Add the mod's id under
          Mods as well, or the server has nothing to load and starts on The Island.
        </span>
      ) : null}
      {!custom && note ? <span className="field-help">{note}</span> : null}
    </>
  );
}

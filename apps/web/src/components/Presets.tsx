import { useStore } from '../lib/store';
import type { PresetDef, SettingDef } from '../lib/types';

/**
 * The play-style picker. Used in three places - the new server wizard, the
 * game settings tab and the setups page - so it stays deliberately dumb:
 * it renders the catalogue and tells you what was clicked.
 */
export function PresetGrid({
  selected,
  onPick,
  compact,
}: {
  selected?: string;
  onPick: (preset: PresetDef) => void;
  compact?: boolean;
}) {
  const { catalog } = useStore();
  const presets = catalog?.presets ?? [];
  if (!presets.length) return null;

  return (
    <div className={`preset-grid ${compact ? 'compact' : ''}`}>
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={`preset-card ${selected === preset.id ? 'active' : ''}`}
          onClick={() => onPick(preset)}
          title={preset.description}
        >
          <span className="preset-top">
            <span className="preset-icon" aria-hidden>
              {preset.icon}
            </span>
            <span className="preset-name">{preset.name}</span>
            {selected === preset.id ? <span className="preset-tick">✓</span> : null}
          </span>
          <span className="preset-tag">{preset.tagline}</span>
          {compact ? null : (
            <ul className="preset-points">
              {preset.highlights.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Presets are written in terms of catalogue keys; the settings form is keyed
 * by `file:section:key`. This bridges the two using the catalogue the server
 * already sends us, so neither side has to hard-code an INI section name.
 */
export function resolvePresetValues(preset: PresetDef, defs: SettingDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(preset.values)) {
    const def = defs.find((d) => d.key.toLowerCase() === key.toLowerCase());
    if (def) out[`${def.file}:${def.section}:${def.key}`] = value;
  }
  return out;
}

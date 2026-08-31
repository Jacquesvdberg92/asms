import { useState } from 'react';
import { Button, Callout, ExternalLink } from './ui';
import { Icon } from './Icons';
import { MOD_SOURCES, modSearchLink } from '../lib/mods';

/**
 * ASMS asks for a number and gives no clue where the number comes from. Four
 * different screens mentioned CurseForge in passing and not one of them linked
 * to it, so this is the answer to "where do I even get mods?" - the same
 * answer in every place the question can occur.
 */
export function ModSources({ open = false }: { open?: boolean }) {
  const [query, setQuery] = useState('');

  const search = () => {
    if (!query.trim()) return;
    window.open(modSearchLink(query), '_blank', 'noopener,noreferrer');
  };

  return (
    <details className="card find-mods" open={open}>
      <summary>
        <Icon.Compass size={16} />
        <span className="strong">Where do I find mods?</span>
        <span className="card-hint">CurseForge, project IDs, and what to paste</span>
        <Icon.Chevron size={14} className="find-mods-caret" />
      </summary>

      <div className="card-body stack">
        <ol className="steps-list">
          <li>
            <strong>Find the mod on CurseForge.</strong> It is the only place ARK: Survival Ascended loads mods from — there
            is no Steam Workshop for ASA.
          </li>
          <li>
            <strong>Copy the number out of its URL.</strong> That number is the project ID, and it is the only part ARK
            actually needs. The name and author you type here are for you.
          </li>
          <li>
            <strong>Paste it in the box above and save.</strong> The server downloads the mod itself on its next start, so
            that start takes noticeably longer than usual.
          </li>
          <li>
            <strong>Tell your players.</strong> Everyone joining needs the same mods; the game prompts them, but a link in
            your Discord saves an evening.
          </li>
        </ol>

        <div className="input-group">
          <input
            className="input"
            value={query}
            placeholder="Search CurseForge by name — Awesome Spyglass, Structures Plus…"
            aria-label="Search CurseForge by mod name"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <Button variant="primary" disabled={!query.trim()} onClick={search}>
            <Icon.Search size={14} /> Search CurseForge
            <Icon.External size={12} />
          </Button>
        </div>

        <div className="grid grid-2">
          {MOD_SOURCES.map((source) => (
            <div key={source.href} className="source-row">
              <ExternalLink href={source.href} className="strong">
                {source.label}
              </ExternalLink>
              <span className="tiny faint">{source.help}</span>
            </div>
          ))}
        </div>

        <Callout tone="warn" title="Mods are the usual reason a server stops booting">
          A mod that has not been updated since ARK&rsquo;s last patch can take the whole server down with it, and ARK&rsquo;s
          own error message never says which one. Add them a few at a time, and use <strong>Check mods</strong> here when a
          start fails.
        </Callout>
      </div>
    </details>
  );
}

import { Button } from './ui';
import { Icon } from './Icons';
import { clusterIdWarning, randomClusterId } from '../lib/cluster';

/**
 * The cluster ID box, wherever it appears: the wizard, the assign dialog and
 * each server's settings. One component so the dice - and the warning about
 * IDs everybody else also picked - cannot go missing from one of them.
 */
export function ClusterIdInput({
  value,
  onChange,
  placeholder = 'ark-… — leave blank for a standalone server',
  autoFocus,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const warning = clusterIdWarning(value);
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input input-mono"
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          size="sm"
          type="button"
          title="Generate a cluster ID nobody else is using"
          onClick={() => onChange(randomClusterId())}
        >
          <Icon.Dice size={14} /> Random
        </Button>
      </div>
      {warning ? <span className="field-error">{warning}</span> : null}
    </>
  );
}

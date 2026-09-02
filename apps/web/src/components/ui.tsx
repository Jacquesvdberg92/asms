import React, { useEffect, useState } from 'react';
import { Icon } from './Icons';
import type { ServerState } from '../lib/types';

// ------------------------------------------------------------------- button

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'ok';
  size?: 'sm' | 'md';
  busy?: boolean;
  block?: boolean;
};

export function Button({ variant = 'default', size = 'md', busy, block, className = '', children, ...rest }: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size === 'sm' ? 'btn-sm' : '',
    block ? 'btn-block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} disabled={rest.disabled || busy} {...rest}>
      {busy ? <span className="spinner" /> : null}
      {children}
    </button>
  );
}

// -------------------------------------------------------------------- field

export function Field({
  label,
  help,
  error,
  children,
  hint,
}: {
  label?: string;
  help?: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      {label ? (
        <label>
          {label}
          {hint}
        </label>
      ) : null}
      {children}
      {help ? <span className="field-help">{help}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  title,
  help,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title?: string;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      {title || help ? (
        <span className="toggle-text">
          {title ? <span className="toggle-title">{title}</span> : null}
          {help ? <span className="toggle-help">{help}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

// -------------------------------------------------------------------- badge

const STATE_META: Record<ServerState, { label: string; tone: string; pulse?: boolean }> = {
  running: { label: 'Running', tone: 'ok' },
  stopped: { label: 'Stopped', tone: '' },
  starting: { label: 'Starting', tone: 'warn', pulse: true },
  stopping: { label: 'Stopping', tone: 'warn', pulse: true },
  installing: { label: 'Installing', tone: 'info', pulse: true },
  updating: { label: 'Updating', tone: 'info', pulse: true },
  crashed: { label: 'Crashed', tone: 'bad' },
};

export function StateBadge({ state }: { state: ServerState }) {
  const meta = STATE_META[state] ?? STATE_META.stopped;
  return (
    <span className={`badge ${meta.tone ? `badge-${meta.tone}` : ''}`}>
      <span className={`dot ${meta.tone ? `dot-${meta.tone}` : ''} ${meta.pulse ? 'dot-pulse' : ''}`} />
      {meta.label}
    </span>
  );
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'accent'; children: React.ReactNode }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{children}</span>;
}

export function Meter({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tone = pct > 88 ? 'bad' : pct > 70 ? 'warn' : 'ok';
  return (
    <div className={`meter ${tone}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

// -------------------------------------------------------------------- modal

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <Icon.X />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Confirm({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  requireText,
  onConfirm,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** When set, the user must type this exact string to enable the button. */
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const armed = !requireText || typed === requireText;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!armed}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="dim">{body}</div>
        {requireText ? (
          <Field label={`Type "${requireText}" to confirm`}>
            <input className="input input-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------- misc

export function Empty({ icon, title, body, action }: { icon: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
  variant = 'ghost',
  size = 'sm',
}: {
  text: string;
  label?: string;
  variant?: 'ghost' | 'default' | 'primary';
  size?: 'sm' | 'md';
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <Icon.Check /> : <Icon.Copy />}
      {done ? 'Copied' : label}
    </Button>
  );
}

/** Tiny inline sparkline, no chart library needed. */
export function Spark({ values, width = 76, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg className="spark" width={width} height={height} />;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

// ----------------------------------------------------------------- callout

type Tone = 'info' | 'warn' | 'danger' | 'ok';

const TONE_ICON: Record<Tone, typeof Icon.Info> = {
  info: Icon.Info,
  warn: Icon.Alert,
  danger: Icon.Alert,
  ok: Icon.Check,
};

/**
 * The one way to say "read this before you carry on". Five files had grown
 * their own coloured <div> for the job, which meant a warning looked different
 * depending on which page you were standing on - so a serious one and a
 * throwaway one read the same. Tone is the whole message: info explains, warn
 * means you will lose time, danger means you will lose data.
 */
export function Callout({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Glyph = TONE_ICON[tone];
  return (
    <div className={`callout ${tone === 'info' ? '' : tone}`}>
      <Glyph size={15} />
      <div className="callout-text">
        {title ? <div className="callout-title">{title}</div> : null}
        {children}
      </div>
      {action ? <div className="callout-action">{action}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------ search / find

/**
 * Every list long enough to scroll gets one of these. It reports what it has
 * filtered out as well as what it kept, because a filter you forgot you typed
 * looks exactly like data that has gone missing.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  hint,
  autoFocus,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown to the right of the box, e.g. "3 of 24". */
  hint?: React.ReactNode;
  autoFocus?: boolean;
  width?: number;
}) {
  return (
    <div className="search-box" style={width ? { maxWidth: width } : undefined}>
      <Icon.Search size={14} className="search-icon" />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && value && (e.stopPropagation(), onChange(''))}
      />
      {value ? (
        <button className="search-clear" onClick={() => onChange('')} aria-label="Clear search" title="Clear (Esc)">
          <Icon.X size={13} />
        </button>
      ) : null}
      {hint ? <span className="search-hint">{hint}</span> : null}
    </div>
  );
}

/** A link that leaves ASMS, always marked as one. */
export function ExternalLink({
  href,
  children,
  className = '',
  title,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className} title={title ?? href}>
      {children} <Icon.External size={12} />
    </a>
  );
}

import React, { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** Optional bold first line. */
  title?: string;
  /** The explanation. Strings may contain <code> spans via `code`. */
  body: React.ReactNode;
  children: React.ReactElement | React.ReactNode;
  placement?: 'top' | 'bottom';
  /** Render the trigger inline with a dotted underline (for terms in prose). */
  asHint?: boolean;
}

/**
 * Hover- and focus-triggered explanation, positioned with fixed coordinates in
 * a portal so it is never clipped by a card's overflow. Keyboard users get the
 * same text on focus, and Escape dismisses it.
 */
export function Tooltip({ title, body, children, placement = 'top', asHint }: TooltipProps) {
  const [coords, setCoords] = useState<{ x: number; y: number; place: 'top' | 'bottom' } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const id = useId();

  const show = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Flip below when there is not enough headroom.
    const place = placement === 'top' && rect.top < 110 ? 'bottom' : placement;
    setCoords({
      x: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150),
      y: place === 'top' ? rect.top - 10 : rect.bottom + 10,
      place,
    });
  }, [placement]);

  const hide = useCallback(() => setCoords(null), []);

  return (
    <>
      <span
        ref={anchor}
        className={`tip-anchor ${asHint ? 'hint' : ''}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
        aria-describedby={coords ? id : undefined}
        tabIndex={asHint ? 0 : undefined}
      >
        {children}
      </span>
      {coords
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className="tip"
              style={{
                left: coords.x,
                top: coords.y,
                transform: coords.place === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              }}
            >
              {title ? <div className="tip-title">{title}</div> : null}
              <div className="tip-body">{body}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Small circled "?" that explains a nearby label. */
export function Help({ title, body }: { title?: string; body: React.ReactNode }) {
  return (
    <Tooltip title={title} body={body}>
      <span
        tabIndex={0}
        aria-label="More information"
        style={{
          width: 15,
          height: 15,
          borderRadius: 99,
          border: '1px solid var(--line-strong)',
          color: 'var(--text-faint)',
          fontSize: 10,
          fontWeight: 700,
          display: 'inline-grid',
          placeItems: 'center',
          cursor: 'help',
          flex: 'none',
        }}
      >
        ?
      </span>
    </Tooltip>
  );
}

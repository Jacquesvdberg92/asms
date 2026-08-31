import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scroll to whatever the URL fragment names — /settings#access, /guide#ports —
 * because a data router does not do it for you, and neither does the browser:
 * the page scrolls inside .content rather than inside the document.
 *
 * It checks its own work rather than firing once and hoping. On a cold load the
 * cards are still settling when the first attempt lands, and a scroll into a
 * box that has not reached its final height quietly puts you back at the top,
 * which reads as a broken link.
 */
export function useHashTarget(flash = false): void {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    let attempts = 0;
    let timer = 0;

    const settle = () => {
      const el = document.getElementById(id);
      const scroller = el?.closest('.content');
      if (!el || !scroller) {
        if (attempts++ < 20) timer = window.setTimeout(settle, 60);
        return;
      }

      const offBy = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      if (Math.abs(offBy) < 8 || scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2) {
        if (flash) {
          el.classList.add('flash');
          window.setTimeout(() => el.classList.remove('flash'), 1600);
        }
        return;
      }

      // Instant, never smooth: this runs again in 60ms to check its work, and
      // a second scrollIntoView aimed at a target that is still gliding sends
      // the page sailing past it.
      scroller.scrollTop += offBy;
      if (attempts++ < 20) timer = window.setTimeout(settle, 60);
    };

    settle();
    return () => window.clearTimeout(timer);
  }, [hash, flash]);
}

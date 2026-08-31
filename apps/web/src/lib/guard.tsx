import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button, Modal } from '../components/ui';
import { Icon } from '../components/Icons';

/**
 * Editing panels here keep a draft in local state and only push it on Save, so
 * walking away — another tab, the sidebar, the phone's back gesture — silently
 * throws the work out. This asks first, and offers to save on the way.
 *
 * Returns a dialog to render; it is null unless a navigation is actually being
 * held up.
 */
export function useUnsavedGuard({
  when,
  title = 'Unsaved changes',
  body,
  onSave,
  saveLabel = 'Save and leave',
  leaveLabel = 'Leave without saving',
}: {
  /** True while there is something to lose. */
  when: boolean;
  title?: string;
  body: React.ReactNode;
  /** Runs on "Save and leave". Return false to stay put — a failed save must not lose the draft. */
  onSave: () => Promise<boolean | void>;
  saveLabel?: string;
  leaveLabel?: string;
}): React.ReactNode {
  const [saving, setSaving] = useState(false);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname,
  );

  // Closing or reloading the tab is the browser's own warning to show; all it
  // wants from us is a cancelled event. The wording is the browser's, not ours.
  useEffect(() => {
    if (!when) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [when]);

  // If the draft stops being dirty while a navigation is held (a save landing
  // from elsewhere), there is nothing left to ask about - let it through.
  useEffect(() => {
    if (blocker.state === 'blocked' && !when) blocker.proceed();
  }, [blocker, when]);

  if (blocker.state !== 'blocked') return null;

  const saveAndLeave = async () => {
    setSaving(true);
    try {
      if ((await onSave()) === false) return;
      blocker.proceed();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={() => blocker.reset()}
      footer={
        <>
          <Button variant="ghost" onClick={() => blocker.reset()}>
            Stay here
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed()}>
            {leaveLabel}
          </Button>
          <Button variant="primary" busy={saving} onClick={() => void saveAndLeave()}>
            <Icon.Save /> {saveLabel}
          </Button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <Icon.Alert />
        <div className="dim">{body}</div>
      </div>
    </Modal>
  );
}

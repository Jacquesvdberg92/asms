import { useEffect, useState } from 'react';
import { useStore, useAction } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Confirm, Empty, Field, Modal, Toggle, Badge } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help } from '../../components/Tooltip';
import { dateTime, when } from '../../lib/format';
import type { ScheduleAction, ScheduleTask, ServerInstance } from '../../lib/types';

const PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily 06:00', cron: '0 6 * * *' },
  { label: 'Twice daily', cron: '0 6,18 * * *' },
  { label: 'Every 4 hours', cron: '0 */4 * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Weekly, Monday 05:00', cron: '0 5 * * 1' },
];

const ACTION_LABEL: Record<ScheduleAction, string> = {
  restart: 'Restart server',
  backup: 'Take a backup',
  update: 'Update then restart',
  stop: 'Stop server',
  start: 'Start server',
  rcon: 'Run an RCON command',
};

export default function Schedule({ server }: { server: ServerInstance }) {
  const { schedules } = useStore();
  const [busy, run] = useAction();
  const [editing, setEditing] = useState<ScheduleTask | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ScheduleTask | null>(null);

  const rows = schedules.filter((t) => t.serverId === server.id);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon.Clock />
          <h3>Scheduled tasks</h3>
          <Help
            title="What a schedule does"
            body="Runs a restart, backup, update or RCON command on a repeating timetable. A nightly restart and a daily backup cover most servers."
          />
          <span className="badge">{rows.length}</span>
          <div className="spacer" />
          <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
            <Icon.Plus /> New task
          </Button>
        </div>

        {rows.length === 0 ? (
          <Empty
            icon="⏰"
            title="Nothing scheduled"
            body="A nightly restart and a daily backup cover most servers. Warnings are broadcast in game so the restart lands exactly on the hour."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                Add your first task
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Schedule</th>
                  <th>Next run</th>
                  <th>Last run</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div className="strong">{task.name}</div>
                      <div className="tiny faint">
                        {ACTION_LABEL[task.action]}
                        {task.action === 'rcon' && task.command ? ` · ${task.command}` : ''}
                      </div>
                    </td>
                    <td>
                      <div className="mono small">{task.cron}</div>
                      {task.warnMinutes.length && task.action !== 'backup' && task.action !== 'rcon' ? (
                        <div className="tiny faint">warns at {task.warnMinutes.join(', ')} min</div>
                      ) : null}
                    </td>
                    <td className="small">{task.enabled ? (task.nextRun ? `${dateTime(task.nextRun)} (${when(task.nextRun)})` : 'never') : <span className="faint">paused</span>}</td>
                    <td className="small">
                      {task.lastRun ? (
                        <>
                          <div>{when(task.lastRun)}</div>
                          <Badge tone={task.lastResult === 'ok' ? 'ok' : 'bad'}>{task.lastResult}</Badge>
                        </>
                      ) : (
                        <span className="faint">never</span>
                      )}
                    </td>
                    <td className="right">
                      <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                        <Toggle
                          checked={task.enabled}
                          onChange={(v) => void run(() => api.patch(`/schedules/${task.id}`, { enabled: v }))}
                        />
                        <Button size="sm" busy={busy} onClick={() => void run(() => api.post(`/schedules/${task.id}/run`), 'Running now')}>
                          Run
                        </Button>
                        <Button size="sm" onClick={() => setEditing(task)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(task)}>
                          <Icon.Trash size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <TaskModal
          serverId={server.id}
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <Confirm
          title="Delete this task?"
          danger
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => void run(() => api.del(`/schedules/${deleting.id}`), 'Task deleted')}
          body={<p>"{deleting.name}" will stop running.</p>}
        />
      ) : null}
    </div>
  );
}

function TaskModal({ serverId, task, onClose }: { serverId: string; task: ScheduleTask | null; onClose: () => void }) {
  const [busy, run] = useAction();
  const [name, setName] = useState(task?.name ?? 'Nightly restart');
  const [action, setAction] = useState<ScheduleAction>(task?.action ?? 'restart');
  const [cron, setCron] = useState(task?.cron ?? '0 6 * * *');
  const [warn, setWarn] = useState((task?.warnMinutes ?? [15, 10, 5, 1]).join(', '));
  const [command, setCommand] = useState(task?.command ?? '');
  const [preview, setPreview] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' });

  useEffect(() => {
    const t = setTimeout(() => {
      void api
        .post<{ ok: boolean; next?: string; error?: string }>('/schedules/validate', { cron })
        .then((res) => setPreview({ ok: res.ok, text: res.ok ? `Next run: ${res.next}` : (res.error ?? 'Invalid') }))
        .catch(() => setPreview({ ok: false, text: 'Could not validate' }));
    }, 250);
    return () => clearTimeout(t);
  }, [cron]);

  const showWarnings = action !== 'backup' && action !== 'rcon' && action !== 'start';

  const save = () =>
    void run(async () => {
      const payload = {
        serverId,
        name,
        action,
        cron,
        command,
        warnMinutes: warn
          .split(/[,\s]+/)
          .map((n) => Number(n.trim()))
          .filter((n) => Number.isFinite(n) && n > 0),
      };
      if (task) await api.patch(`/schedules/${task.id}`, payload);
      else await api.post('/schedules', payload);
      onClose();
    }, task ? 'Task updated' : 'Task created');

  return (
    <Modal
      title={task ? 'Edit task' : 'New scheduled task'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!preview.ok} onClick={save}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Action">
          <select className="select" value={action} onChange={(e) => setAction(e.target.value as ScheduleAction)}>
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {action === 'rcon' ? (
          <Field label="RCON command" help="Runs exactly as typed, e.g. DestroyWildDinos">
            <input className="input input-mono" value={command} onChange={(e) => setCommand(e.target.value)} />
          </Field>
        ) : null}
        <Field label="When" help={preview.text} error={preview.ok ? undefined : preview.text}>
          <input className="input input-mono" value={cron} onChange={(e) => setCron(e.target.value)} />
        </Field>
        <div className="btn-group">
          {PRESETS.map((p) => (
            <Button key={p.cron} size="sm" variant={cron === p.cron ? 'primary' : 'default'} onClick={() => setCron(p.cron)}>
              {p.label}
            </Button>
          ))}
        </div>
        {showWarnings ? (
          <Field
            label="Warning countdown (minutes)"
            help="ASMS starts broadcasting early so the action itself happens exactly at the scheduled time. Leave blank for no warnings."
          >
            <input className="input input-mono" value={warn} onChange={(e) => setWarn(e.target.value)} placeholder="15, 10, 5, 1" />
          </Field>
        ) : null}
        <div className="small faint">
          Cron fields are <span className="mono">minute hour day month weekday</span>. Weekday 0 is Sunday.
        </div>
      </div>
    </Modal>
  );
}

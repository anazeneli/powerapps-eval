import type { AuditEvent, User } from '@kyc/shared';
import { ROLE_LABELS, STATUS_LABELS, formatTime, userName } from './format';

function formatValue(field: string, v: unknown, users: User[]): string {
  if (v === null || v === undefined) return '—';
  if (field === 'status') return STATUS_LABELS[v as keyof typeof STATUS_LABELS] ?? String(v);
  if (field.endsWith('Id')) return userName(users, String(v));
  return String(v);
}

export function AuditTrail({
  events,
  users,
  showEntity,
  onOpenCase,
}: {
  events: AuditEvent[];
  users: User[];
  showEntity?: boolean;
  onOpenCase?: (id: string) => void;
}) {
  return (
    <table className="grid audit" data-testid="audit-table">
      <thead>
        <tr>
          <th>#</th>
          <th>When</th>
          <th>Who</th>
          <th>Action</th>
          {showEntity && <th>Case</th>}
          <th>Changes</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td className="mono muted">{e.id}</td>
            <td className="nowrap">{formatTime(e.at)}</td>
            <td>
              {userName(users, e.actorId)}
              <div className="muted small">{ROLE_LABELS[e.actorRole] ?? e.actorRole}</div>
            </td>
            <td className="mono">{e.action}</td>
            {showEntity && (
              <td className="mono">
                {onOpenCase ? (
                  <button className="link" onClick={() => onOpenCase(e.entityId)}>
                    {e.entityId}
                  </button>
                ) : (
                  e.entityId
                )}
              </td>
            )}
            <td>
              {e.changes &&
                Object.entries(e.changes).map(([field, { from, to }]) => (
                  <div key={field} className="small">
                    <span className="muted">{field}:</span> {formatValue(field, from, users)} → <b>{formatValue(field, to, users)}</b>
                  </div>
                ))}
            </td>
            <td className="small">{e.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

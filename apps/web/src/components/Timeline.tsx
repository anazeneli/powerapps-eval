import { Avatar, Text, makeStyles, tokens } from '@fluentui/react-components';
import { Bot20Regular } from '@fluentui/react-icons';
import type { AuditEvent } from '@kyc/shared';
import { ROLE_LABELS, auditActionLabel, fieldLabel, formatTime, formatValue, userName } from '../format';
import type { Named } from '../format';

const useStyles = makeStyles({
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: {
    display: 'grid',
    gridTemplateColumns: '32px 1fr',
    gap: '10px',
    padding: '10px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  line: { display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap' },
  time: { marginLeft: 'auto', color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  changes: { marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' },
  reason: {
    marginTop: '6px',
    padding: '6px 10px',
    background: tokens.colorNeutralBackground3,
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    fontSize: tokens.fontSizeBase200,
  },
  empty: { color: tokens.colorNeutralForeground3, padding: '12px 0' },
});

export function ChangeList({ e, users }: { e: AuditEvent; users: Named[] }) {
  const s = useStyles();
  if (!e.changes || Object.keys(e.changes).length === 0) return null;
  return (
    <div className={s.changes}>
      {Object.entries(e.changes).map(([field, { from, to }]) =>
        Array.isArray(to) ? (
          <Text key={field} size={200} title={to.join(', ')}>
            <span className={s.muted}>{fieldLabel(field)}:</span> <b>{to.length} records</b>
            {to.length > 0 && ` (${to.slice(0, 3).join(', ')}${to.length > 3 ? ` +${to.length - 3} more` : ''})`}
          </Text>
        ) : (
          <Text key={field} size={200}>
            <span className={s.muted}>{fieldLabel(field)}:</span> {formatValue(field, from, users)} → <b>{formatValue(field, to, users)}</b>
          </Text>
        ),
      )}
    </div>
  );
}

export function ActorAvatar({ actorId, users, size = 32 }: { actorId: string; users: Named[]; size?: 20 | 24 | 28 | 32 }) {
  const system = actorId.startsWith('system:');
  return (
    <Avatar
      size={size}
      name={system ? undefined : userName(users, actorId)}
      icon={system ? <Bot20Regular /> : undefined}
      color={system ? 'neutral' : 'colorful'}
    />
  );
}

export function Timeline({ events, users }: { events: AuditEvent[]; users: Named[] }) {
  const s = useStyles();
  if (events.length === 0) return <div className={s.empty}>No activity yet.</div>;
  return (
    <ol className={s.list} data-testid="audit-table">
      {events.map((e) => (
        <li key={e.id} className={s.item}>
          <ActorAvatar actorId={e.actorId} users={users} />
          <div>
            <div className={s.line}>
              <Text weight="semibold">{userName(users, e.actorId)}</Text>
              <Text>{auditActionLabel(e)}</Text>
              <Text size={200} className={s.time} title={e.requestId ? `Request ${e.requestId}` : undefined}>
                {formatTime(e.at)}
              </Text>
            </div>
            <Text size={200} className={s.muted}>
              {ROLE_LABELS[e.actorRole] ?? e.actorRole} · <span className="mono">{e.action}</span> · #{e.id}
            </Text>
            <ChangeList e={e} users={users} />
            {e.reason && <div className={s.reason}>{e.reason}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

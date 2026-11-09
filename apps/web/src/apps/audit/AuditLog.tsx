import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  SearchBox,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableCellLayout,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowDownload20Regular, ShieldCheckmark20Regular } from '@fluentui/react-icons';
import { APPS, type AuditEvent } from '@kyc/shared';
import type { Named } from '../../format';
import { download, get } from '../../api';
import { ROLE_LABELS, auditActionLabel, formatTime, userName } from '../../format';
import { ActorAvatar, ChangeList } from '../../components/Timeline';
import { PageHeader, Surface } from '../../views/Page';

const useStyles = makeStyles({
  toolbar: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' },
  search: { width: '320px' },
  count: { marginLeft: 'auto', color: tokens.colorNeutralForeground3 },
  muted: { color: tokens.colorNeutralForeground3 },
  msg: { marginBottom: '12px' },
});

export function AuditLog({
  users,
  initialAction,
  onOpenCase,
}: {
  users: Named[];
  initialAction?: string;
  onOpenCase: (id: string) => void;
}) {
  const s = useStyles();
  const [query, setQuery] = useState('');
  const [action, setAction] = useState(initialAction ?? '');
  const [appFilter, setAppFilter] = useState('');
  const audit = useQuery({ queryKey: ['audit', 'all', appFilter], queryFn: () => get<AuditEvent[]>(`/audit?limit=500${appFilter ? `&app=${appFilter}` : ''}`) });
  const verify = useMutation({ mutationFn: () => get<{ ok: boolean; count: number; brokenAtId: number | null; reason?: string }>('/audit/verify') });

  const actions = useMemo(() => [...new Set((audit.data ?? []).map((e) => e.action))].sort(), [audit.data]);
  const q = query.trim().toLowerCase();
  const events = (audit.data ?? []).filter(
    (e) =>
      (!action || e.action === action) &&
      (!q || [e.action, e.entityId, userName(users, e.actorId), e.reason ?? ''].some((v) => v.toLowerCase().includes(q))),
  );

  return (
    <section>
      <PageHeader title="Audit log" subtitle="Every change, view and access grant across all apps: append-only and hash-chained">
        <Button icon={<ShieldCheckmark20Regular />} onClick={() => verify.mutate()} disabled={verify.isPending} data-testid="verify-chain">
          Verify hash chain
        </Button>
        <Button appearance="primary" icon={<ArrowDownload20Regular />} onClick={() => download(`/audit/export.csv${appFilter ? `?app=${appFilter}` : ''}`, 'audit-log.csv')}>
          Export CSV
        </Button>
      </PageHeader>

      {verify.data && (
        <MessageBar layout="multiline" intent={verify.data.ok ? 'success' : 'error'} className={s.msg} data-testid="verify-result">
          <MessageBarBody>
            <MessageBarTitle>{verify.data.ok ? 'Chain intact.' : 'Chain broken.'}</MessageBarTitle>
            {verify.data.ok
              ? `Chain intact: ${verify.data.count} events verified.`
              : `${verify.data.brokenAtId === null ? '' : `Chain broken at event #${verify.data.brokenAtId}. `}${verify.data.reason ?? ''}`}
          </MessageBarBody>
        </MessageBar>
      )}
      <MessageBar layout="multiline" intent="info" className={s.msg}>
        <MessageBarBody>
          The database rejects updates and deletes on this table, and each event's hash covers the previous one, so edits are detectable.
        </MessageBarBody>
      </MessageBar>

      <Surface>
        <div className={s.toolbar}>
          <SearchBox className={s.search} placeholder="Filter by case, user, reason" value={query} onChange={(_, d) => setQuery(d.value)} />
          <Select value={appFilter} onChange={(_, d) => setAppFilter(d.value)} aria-label="App">
            <option value="">All apps</option>
            {APPS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select value={action} onChange={(_, d) => setAction(d.value)} aria-label="Action">
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <Text size={200} className={s.count}>
            {events.length} events
          </Text>
        </div>
        {audit.isLoading ? (
          <Spinner />
        ) : audit.error ? (
          <MessageBar layout="multiline" intent="error">
            <MessageBarBody>{(audit.error as Error).message}</MessageBarBody>
          </MessageBar>
        ) : (
          <Table size="small" data-testid="audit-table" aria-label="Audit events">
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: 56 }}>#</TableHeaderCell>
                <TableHeaderCell style={{ width: 170 }}>When</TableHeaderCell>
                <TableHeaderCell style={{ width: 220 }}>Who</TableHeaderCell>
                <TableHeaderCell style={{ width: 220 }}>Action</TableHeaderCell>
                <TableHeaderCell style={{ width: 110 }}>App</TableHeaderCell>
                <TableHeaderCell style={{ width: 130 }}>Record</TableHeaderCell>
                <TableHeaderCell>Changes</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className={`mono ${s.muted}`}>{e.id}</TableCell>
                  <TableCell>{formatTime(e.at)}</TableCell>
                  <TableCell>
                    <TableCellLayout media={<ActorAvatar actorId={e.actorId} users={users} size={24} />} description={ROLE_LABELS[e.actorRole] ?? e.actorRole}>
                      {userName(users, e.actorId)}
                    </TableCellLayout>
                  </TableCell>
                  <TableCell>
                    <TableCellLayout description={<span className="mono">{e.action}</span>}>{auditActionLabel(e)}</TableCellLayout>
                  </TableCell>
                  <TableCell>{APPS.find((x) => x.id === e.appId)?.name ?? e.appId}</TableCell>
                  <TableCell>
                    <Link className="mono" disabled={e.entityType !== 'case'} onClick={() => onOpenCase(e.entityId)}>
                      {e.entityId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ChangeList e={e} users={users} />
                  </TableCell>
                  <TableCell>
                    <Text size={200}>{e.reason}</Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Surface>
    </section>
  );
}

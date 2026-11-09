import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AuditEvent, User } from '@kyc/shared';
import { download, get } from './api';
import { AuditTrail } from './AuditTrail';

export function AuditLog({ users, onOpenCase }: { users: User[]; onOpenCase: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const audit = useQuery({ queryKey: ['audit', 'all'], queryFn: () => get<AuditEvent[]>('/audit?limit=500') });
  const verify = useMutation({
    mutationFn: () => get<{ ok: boolean; count: number; brokenAtId: number | null }>('/audit/verify'),
  });

  const q = query.trim().toLowerCase();
  const events = (audit.data ?? []).filter(
    (e) => !q || [e.action, e.entityId, e.actorId, e.reason ?? ''].some((s) => s.toLowerCase().includes(q)),
  );

  return (
    <section>
      <div className="panel-header">
        <h1>Audit log</h1>
        <div className="toolbar">
          <input placeholder="Filter by action, case, user, reason" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button onClick={() => verify.mutate()} data-testid="verify-chain">
            Verify hash chain
          </button>
          <button onClick={() => download('/audit.csv', 'audit-log.csv')}>Export CSV</button>
        </div>
      </div>
      {verify.data && (
        <p className={verify.data.ok ? 'ok' : 'error'} data-testid="verify-result">
          {verify.data.ok
            ? `Chain intact: ${verify.data.count} events verified.`
            : `Chain broken at event #${verify.data.brokenAtId}.`}
        </p>
      )}
      <p className="hint">
        Append-only: the database rejects updates and deletes on this table, and each event's hash covers the previous one.
      </p>
      {audit.error ? <p className="error">{(audit.error as Error).message}</p> : <AuditTrail events={events} users={users} showEntity onOpenCase={onOpenCase} />}
    </section>
  );
}

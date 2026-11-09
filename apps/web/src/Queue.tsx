import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { KycCase, User } from '@kyc/shared';
import { get } from './api';
import { STATUS_LABELS, age, userName } from './format';

const FILTERS = [
  ['all', 'All visible'],
  ['new', 'New'],
  ['mine', 'Assigned to me'],
  ['pending_info', 'Waiting on customer'],
  ['escalated', 'Escalated'],
  ['second_approval', 'Awaiting 2nd approval'],
  ['closed', 'Closed'],
] as const;

export function Queue({ me, users, onOpen }: { me: User; users: User[]; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<string>('all');
  const cases = useQuery({
    queryKey: ['cases', me.id, filter],
    queryFn: () => get<KycCase[]>(`/cases?filter=${filter}`),
  });

  return (
    <section>
      <div className="tabs">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={filter === key ? 'tab active' : 'tab'} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>
      {me.role === 'analyst' && (
        <p className="hint">As an analyst you only see unassigned new cases and cases assigned to you (row-level access).</p>
      )}
      {cases.isLoading ? (
        <p>Loading…</p>
      ) : cases.error ? (
        <p className="error">{(cases.error as Error).message}</p>
      ) : (
        <table className="grid" data-testid="queue-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Customer</th>
              <th>Risk</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Age (SLA 48h)</th>
            </tr>
          </thead>
          <tbody>
            {cases.data!.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No cases
                </td>
              </tr>
            )}
            {cases.data!.map((c) => {
              const a = age(c.createdAt);
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)} className="clickable">
                  <td className="mono">{c.id}</td>
                  <td>{c.customerName}</td>
                  <td>
                    <span className={`badge risk-${c.riskLevel}`}>
                      {c.riskLevel} · {c.riskScore}
                    </span>
                  </td>
                  <td>
                    <span className={`badge status-${c.status}`}>{STATUS_LABELS[c.status]}</span>
                  </td>
                  <td>{userName(users, c.assigneeId)}</td>
                  <td className={a.overdue && !['approved', 'rejected'].includes(c.status) ? 'overdue' : ''}>{a.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

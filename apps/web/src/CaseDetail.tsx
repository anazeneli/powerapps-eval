import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPROVE_REASON_CODES,
  REJECT_REASON_CODES,
  can,
  type Action,
  type AuditEvent,
  type KycCase,
  type User,
} from '@kyc/shared';
import { get, post } from './api';
import { STATUS_LABELS, age, formatTime, userName } from './format';
import { AuditTrail } from './AuditTrail';

type CaseAction = 'claim' | 'request_info' | 'resume' | 'escalate' | 'approve' | 'reject';

const ACTION_LABELS: Record<CaseAction, string> = {
  claim: 'Claim',
  request_info: 'Request info',
  resume: 'Info received',
  escalate: 'Escalate',
  approve: 'Approve',
  reject: 'Reject',
};

export function CaseDetail({ me, users, id, onBack }: { me: User; users: User[]; id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const caseQuery = useQuery({ queryKey: ['case', me.id, id], queryFn: () => get<KycCase>(`/cases/${id}`), staleTime: Infinity });
  const [lostAccess, setLostAccess] = useState<CaseAction | null>(null);
  const audit = useQuery({
    queryKey: ['audit', me.id, id],
    queryFn: () => get<AuditEvent[]>(`/cases/${id}/audit`),
    enabled: !lostAccess,
  });
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [showViews, setShowViews] = useState(false);

  const act = useMutation({
    mutationFn: (action: CaseAction) =>
      post<KycCase>(`/cases/${id}/actions/${action}`, { note: note || undefined, reasonCode: reasonCode || undefined }),
    onSuccess: (updated, action) => {
      queryClient.setQueryData(['case', me.id, id], updated);
      if (!can(me, 'case.view', updated).ok) {
        setLostAccess(action);
        queryClient.removeQueries({ queryKey: ['audit', me.id, id] });
      }
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      setNote('');
      setReasonCode('');
    },
  });

  const reveal = useMutation({
    mutationFn: (justification: string) => post<{ ssn: string }>(`/cases/${id}/reveal-ssn`, { justification }),
    onSuccess: ({ ssn }) => {
      setRevealed(ssn);
      setTimeout(() => setRevealed(null), 30_000);
      queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  if (caseQuery.isLoading) return <p>Loading…</p>;
  if (caseQuery.error)
    return (
      <section>
        <button className="link" onClick={onBack}>
          ← Back to queue
        </button>
        <p className="error">{(caseQuery.error as Error).message}</p>
      </section>
    );

  const c = caseQuery.data!;
  const a = age(c.createdAt);
  const decision = (action: CaseAction) => can(me, `case.${action}` as Action, c);
  const revealDecision = can(me, 'case.reveal_ssn', c);
  const events = (audit.data ?? []).filter((e) => showViews || e.action !== 'case.viewed');
  const reasonOptions = { ...APPROVE_REASON_CODES, ...REJECT_REASON_CODES };

  return (
    <section>
      <button className="link" onClick={onBack}>
        ← Back to queue
      </button>
      <div className="case-header">
        <h1>
          <span className="mono">{c.id}</span> · {c.customerName}
        </h1>
        <span className={`badge status-${c.status}`} data-testid="case-status">
          {STATUS_LABELS[c.status]}
        </span>
        <span className={`badge risk-${c.riskLevel}`}>
          {c.riskLevel} risk · {c.riskScore}
        </span>
      </div>

      <div className="columns">
        <div className="panel">
          <h2>Customer</h2>
          <dl>
            <dt>Date of birth</dt>
            <dd>{c.dateOfBirth}</dd>
            <dt>Country</dt>
            <dd>{c.country}</dd>
            <dt>SSN</dt>
            <dd>
              <span className="mono" data-testid="ssn">
                {revealed ?? c.ssnMasked}
              </span>{' '}
              {!revealed && (
                <button
                  className="small-btn"
                  disabled={!revealDecision.ok || reveal.isPending}
                  title={revealDecision.ok ? 'Reveal is logged with your justification' : revealDecision.reason}
                  onClick={() => {
                    const j = window.prompt('Justification for revealing the full SSN (logged):');
                    if (j) reveal.mutate(j);
                  }}
                >
                  Reveal
                </button>
              )}
              {revealed && <span className="muted small"> (hides in 30s)</span>}
            </dd>
            <dt>Assignee</dt>
            <dd>{userName(users, c.assigneeId)}</dd>
            <dt>First approver</dt>
            <dd>{userName(users, c.firstApproverId)}</dd>
            <dt>Second approver</dt>
            <dd>{userName(users, c.secondApproverId)}</dd>
            <dt>Decision reason</dt>
            <dd>{c.decisionReasonCode ? reasonOptions[c.decisionReasonCode as keyof typeof reasonOptions] : '—'}</dd>
            <dt>Opened</dt>
            <dd>
              {formatTime(c.createdAt)} <span className={a.overdue ? 'overdue' : 'muted'}>({a.label} old)</span>
            </dd>
          </dl>
          {reveal.error && <p className="error">{(reveal.error as Error).message}</p>}

          <h2>Identity verification results</h2>
          <table className="grid">
            <tbody>
              {c.vendorChecks.map((v) => (
                <tr key={v.check}>
                  <td>{v.check}</td>
                  <td>
                    <span className={`badge outcome-${v.outcome}`}>{v.outcome}</span>
                  </td>
                  <td className="small">{v.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel actions">
          <h2>Actions</h2>
          {lostAccess && (
            <div className="notice" data-testid="access-ended">
              <p>
                <b>{ACTION_LABELS[lostAccess]}</b> recorded in the audit trail. You no longer have access to this case
                {c.status === 'escalated' ? ': it is now in the senior reviewer queue.' : '.'}
              </p>
              <button onClick={onBack}>Back to queue</button>
            </div>
          )}
          {c.riskLevel === 'high' && !['approved', 'rejected'].includes(c.status) && (
            <p className="hint">High-risk case: approval needs a second sign-off from a different senior reviewer.</p>
          )}
          <label>
            Reason code (required to approve or reject)
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} data-testid="reason-code">
              <option value="">—</option>
              <optgroup label="Approve">
                {Object.entries(APPROVE_REASON_CODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Reject">
                {Object.entries(REJECT_REASON_CODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            Note (required to request info or escalate)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} data-testid="note" />
          </label>
          <div className="action-buttons">
            {(Object.keys(ACTION_LABELS) as CaseAction[]).map((action) => {
              const d = decision(action);
              return (
                <button
                  key={action}
                  className={`action ${action}`}
                  disabled={!d.ok || act.isPending || !!lostAccess}
                  title={d.ok ? '' : d.reason}
                  onClick={() => act.mutate(action)}
                >
                  {ACTION_LABELS[action]}
                </button>
              );
            })}
          </div>
          <p className="muted small">Hover a disabled button to see why. The API enforces the same rules.</p>
          {act.error && (
            <p className="error" data-testid="action-error">
              {(act.error as Error).message}
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Audit trail</h2>
          <label className="small">
            <input type="checkbox" checked={showViews} onChange={(e) => setShowViews(e.target.checked)} /> Show views
          </label>
        </div>
        {lostAccess ? (
          <p className="muted">Audit history is hidden because you no longer have access to this case.</p>
        ) : audit.error ? (
          <p className="error">{(audit.error as Error).message}</p>
        ) : (
          <AuditTrail events={events} users={users} />
        )}
      </div>
    </section>
  );
}

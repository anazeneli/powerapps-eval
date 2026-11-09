import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody,
  Select, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, Textarea, makeStyles, tokens,
} from '@fluentui/react-components';
import { Add20Regular, ArrowLeft20Regular, CheckmarkCircle20Regular, DocumentBulletList20Regular, DismissCircle20Regular, Person20Regular, PeopleTeam20Regular, Clock20Regular } from '@fluentui/react-icons';
import {
  REFUND_REASON_CODES, REFUND_REJECT_CODES, SINGLE_APPROVAL_LIMIT, canRefund, formatMoney, needsSecondApproval,
  type AuditEvent, type Charge, type Refund, type RefundRole, type RefundStatus,
} from '@kyc/shared';
import { get, post } from '../../api';
import { AppShell } from '../../shell/AppShell';
import { usePlatform } from '../../platform/context';
import { PageHeader, Surface } from '../../views/Page';
import { Timeline } from '../../components/Timeline';
import { formatTime, userName } from '../../format';

type Filter = 'all' | 'mine' | 'needs_me' | 'pending' | 'issued' | 'rejected';
const LABELS: Record<Filter, string> = { needs_me: 'Needs my approval', mine: 'My requests', all: 'All refunds', pending: 'Pending', issued: 'Issued', rejected: 'Rejected' };
const STATUS: Record<RefundStatus, { label: string; color: 'warning' | 'important' | 'success' | 'danger' }> = {
  pending_approval: { label: 'Pending approval', color: 'warning' },
  pending_second_approval: { label: 'Pending 2nd approval', color: 'important' },
  issued: { label: 'Issued', color: 'success' },
  rejected: { label: 'Rejected', color: 'danger' },
};
const ICONS: Record<Filter, JSX.Element> = { needs_me: <PeopleTeam20Regular />, mine: <Person20Regular />, all: <DocumentBulletList20Regular />, pending: <Clock20Regular />, issued: <CheckmarkCircle20Regular />, rejected: <DismissCircle20Regular /> };

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  row: { cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' },
  dl: { display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: '8px', margin: 0 },
  dt: { color: tokens.colorNeutralForeground3 },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
});

export function RefundsApp() {
  const { me: person } = usePlatform();
  const me = { id: person.id, name: person.name, role: person.roles.refunds as RefundRole };
  const isApprover = me.role === 'approver' || me.role === 'finance_manager';
  const [filter, setFilter] = useState<Filter>(isApprover ? 'needs_me' : me.role === 'agent' ? 'mine' : 'all');
  const [open, setOpen] = useState<string | null>(null);
  const navItems = (isApprover ? (['needs_me', 'all', 'pending', 'issued', 'rejected'] as Filter[]) : me.role === 'agent' ? (['mine', 'pending', 'issued', 'rejected'] as Filter[]) : (['all', 'pending', 'issued', 'rejected'] as Filter[]))
    .map((f) => ({ value: f, label: LABELS[f], icon: ICONS[f] }));
  return (
    <AppShell appId="refunds" appName="Refunds" nav={[{ header: 'Refunds', items: navItems }]} selected={filter} onSelect={(v) => { setFilter(v as Filter); setOpen(null); }}>
      {open ? <RefundForm id={open} me={me} onBack={() => setOpen(null)} /> : <RefundList filter={filter} me={me} onOpen={setOpen} />}
    </AppShell>
  );
}

function RefundList({ filter, me, onOpen }: { filter: Filter; me: { id: string; name: string; role: RefundRole }; onOpen: (id: string) => void }) {
  const s = useStyles();
  const { users } = usePlatform();
  const [creating, setCreating] = useState(false);
  const refunds = useQuery({ queryKey: ['refunds', me.id, filter], queryFn: () => get<Refund[]>(`/refunds?filter=${filter}`) });
  return (
    <>
      <PageHeader title={LABELS[filter]} subtitle={`Refunds over ${formatMoney(SINGLE_APPROVAL_LIMIT)} need two approvers. Requesters can never approve their own refund.`}>
        {canRefund(me, 'refund.create').ok && <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCreating(true)} data-testid="new-refund">New refund</Button>}
      </PageHeader>
      <Surface>
        <div className="table-scroll">
        <Table size="small" aria-label="Refunds" data-testid="refund-table">
          <TableHeader>
            <TableRow>
              {['Refund', 'Customer', 'Amount', 'Reason', 'Status', 'Requested by', 'Created'].map((h) => <TableHeaderCell key={h}>{h}</TableHeaderCell>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(refunds.data ?? []).map((r) => (
              <TableRow key={r.id} className={s.row} onClick={() => onOpen(r.id)} data-testid={`refund-${r.id}`}>
                <TableCell className="mono">{r.id}</TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell>{formatMoney(r.amount, r.currency)}</TableCell>
                <TableCell>{REFUND_REASON_CODES[r.reasonCode as keyof typeof REFUND_REASON_CODES] ?? r.reasonCode}</TableCell>
                <TableCell><Badge appearance="tint" color={STATUS[r.status].color}>{STATUS[r.status].label}</Badge></TableCell>
                <TableCell>{userName(users, r.requesterId)}</TableCell>
                <TableCell>{formatTime(r.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        {refunds.data?.length === 0 && <Text block style={{ padding: 16 }}>Nothing here.</Text>}
      </Surface>
      {creating && <NewRefundDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />}
    </>
  );
}

function NewRefundDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const s = useStyles();
  const qc = useQueryClient();
  const charges = useQuery({ queryKey: ['charges'], queryFn: () => get<Charge[]>('/refunds/charges') });
  const [chargeId, setChargeId] = useState('');
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const charge = charges.data?.find((c) => c.id === chargeId);
  const cents = Math.round(Number(amount) * 100);
  const create = useMutation({
    mutationFn: () => post<Refund>('/refunds', { chargeId, amount: cents, reasonCode, note: note || undefined }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['refunds'] }); qc.invalidateQueries({ queryKey: ['charges'] }); onCreated(r.id); },
  });
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form noValidate onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <DialogBody>
            <DialogTitle>New refund request</DialogTitle>
            <DialogContent className={s.form}>
              <Field label="Charge" required>
                <Select value={chargeId} onChange={(_, d) => setChargeId(d.value)} data-testid="refund-charge">
                  <option value="">Select a charge…</option>
                  {(charges.data ?? []).filter((c) => c.refundable > 0).map((c) => (
                    <option key={c.id} value={c.id}>{c.customerName} · {c.description} · {formatMoney(c.refundable, c.currency)} refundable</option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount (USD)" required hint={charge ? `Up to ${formatMoney(charge.refundable)}` : undefined}>
                <Input type="number" min="0.01" step="0.01" value={amount} onChange={(_, d) => setAmount(d.value)} data-testid="refund-amount" />
              </Field>
              <Field label="Reason" required>
                <Select value={reasonCode} onChange={(_, d) => setReasonCode(d.value)} data-testid="refund-reason">
                  <option value="">Select a reason…</option>
                  {Object.entries(REFUND_REASON_CODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Note"><Textarea value={note} onChange={(_, d) => setNote(d.value)} /></Field>
              {cents > 0 && needsSecondApproval(cents) && <MessageBar layout="multiline" intent="info"><MessageBarBody>Over {formatMoney(SINGLE_APPROVAL_LIMIT)}: needs two approvers, the second a finance manager.</MessageBarBody></MessageBar>}
              {create.error && <MessageBar layout="multiline" intent="error"><MessageBarBody>{(create.error as Error).message}</MessageBarBody></MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary" disabled={create.isPending} data-testid="refund-submit">Submit for approval</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

function RefundForm({ id, me, onBack }: { id: string; me: { id: string; name: string; role: RefundRole }; onBack: () => void }) {
  const s = useStyles();
  const qc = useQueryClient();
  const { users } = usePlatform();
  const refund = useQuery({ queryKey: ['refund', me.id, id], queryFn: () => get<Refund>(`/refunds/${id}`) });
  const audit = useQuery({ queryKey: ['refund-audit', me.id, id], queryFn: () => get<AuditEvent[]>(`/refunds/${id}/audit`) });
  const [rejecting, setRejecting] = useState(false);
  const [rejectCode, setRejectCode] = useState('');
  const decide = useMutation({
    mutationFn: (v: { decision: 'approve' | 'reject'; reasonCode?: string }) => post<Refund>(`/refunds/${id}/${v.decision}`, { reasonCode: v.reasonCode }),
    onSuccess: () => { setRejecting(false); qc.invalidateQueries({ queryKey: ['refund'] }); qc.invalidateQueries({ queryKey: ['refund-audit'] }); qc.invalidateQueries({ queryKey: ['refunds'] }); },
  });
  const r = refund.data;
  if (refund.error) return <MessageBar layout="multiline" intent="error"><MessageBarBody>{(refund.error as Error).message}</MessageBarBody></MessageBar>;
  if (!r) return null;
  const approve = canRefund(me, 'refund.approve', r);
  const reject = canRefund(me, 'refund.reject', r);
  const open = r.status === 'pending_approval' || r.status === 'pending_second_approval';
  return (
    <>
      <PageHeader title={`${r.id} · ${formatMoney(r.amount, r.currency)}`} subtitle={r.customerName}>
        <Button icon={<ArrowLeft20Regular />} onClick={onBack}>Back</Button>
      </PageHeader>
      {open && (
        <div className={s.actions} style={{ marginBottom: 16 }}>
          <Button appearance="primary" disabled={!approve.ok || decide.isPending} title={approve.ok ? undefined : approve.reason} onClick={() => decide.mutate({ decision: 'approve' })} data-testid="refund-approve">
            {r.status === 'pending_approval' && needsSecondApproval(r.amount) ? 'Approve (1st of 2)' : 'Approve and issue'}
          </Button>
          <Button disabled={!reject.ok} title={reject.ok ? undefined : reject.reason} onClick={() => setRejecting(true)} data-testid="refund-reject">Reject</Button>
          {!approve.ok && <Text size={200} style={{ alignSelf: 'center' }}>{approve.reason}</Text>}
        </div>
      )}
      {decide.error && <MessageBar layout="multiline" intent="error" style={{ marginBottom: 12 }}><MessageBarBody>{(decide.error as Error).message}</MessageBarBody></MessageBar>}
      <div className={s.grid}>
        <Surface>
          <dl className={s.dl} style={{ padding: 16 }}>
            <dt className={s.dt}>Status</dt><dd><Badge appearance="tint" color={STATUS[r.status].color}>{STATUS[r.status].label}</Badge></dd>
            <dt className={s.dt}>Charge</dt><dd className="mono">{r.chargeId} ({formatMoney(r.chargeAmount, r.currency)})</dd>
            <dt className={s.dt}>Reason</dt><dd>{REFUND_REASON_CODES[r.reasonCode as keyof typeof REFUND_REASON_CODES]}{r.note ? `: ${r.note}` : ''}</dd>
            <dt className={s.dt}>Requested by</dt><dd>{userName(users, r.requesterId)}</dd>
            <dt className={s.dt}>1st approver</dt><dd>{userName(users, r.firstApproverId)}</dd>
            <dt className={s.dt}>2nd approver</dt><dd>{userName(users, r.secondApproverId)}</dd>
            {r.rejectReasonCode && <><dt className={s.dt}>Rejected because</dt><dd>{REFUND_REJECT_CODES[r.rejectReasonCode as keyof typeof REFUND_REJECT_CODES]}</dd></>}
            <dt className={s.dt}>Processor refund</dt><dd className="mono">{r.processorRefundId ?? '—'}</dd>
          </dl>
        </Surface>
        <Surface><div style={{ padding: 16 }}><Text weight="semibold" block style={{ marginBottom: 8 }}>Timeline</Text>{audit.data && <Timeline events={audit.data} users={users} />}</div></Surface>
      </div>
      {rejecting && (
        <Dialog open onOpenChange={(_, d) => !d.open && setRejecting(false)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Reject {r.id}</DialogTitle>
              <DialogContent className={s.form}>
                <Field label="Reason" required>
                  <Select value={rejectCode} onChange={(_, d) => setRejectCode(d.value)} data-testid="refund-reject-reason">
                    <option value="">Select a reason…</option>
                    {Object.entries(REFUND_REJECT_CODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setRejecting(false)}>Cancel</Button>
                <Button appearance="primary" disabled={!rejectCode || decide.isPending} onClick={() => decide.mutate({ decision: 'reject', reasonCode: rejectCode })} data-testid="refund-reject-confirm">Reject refund</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </>
  );
}

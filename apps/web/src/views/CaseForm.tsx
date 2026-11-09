import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Select,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Text,
  Textarea,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowCircleUp20Regular,
  ArrowClockwise20Regular,
  ArrowLeft20Regular,
  Checkmark16Filled,
  Checkmark20Regular,
  Dismiss20Regular,
  Eye20Regular,
  LockClosed20Regular,
  Mail20Regular,
  MailInbox20Regular,
  PersonAdd20Regular,
} from '@fluentui/react-icons';
import {
  APPROVE_REASON_CODES,
  REJECT_REASON_CODES,
  can,
  type Action,
  type AuditEvent,
  type KycCase,
  type User,
} from '@kyc/shared';
import { get, post } from '../api';
import { REASON_LABELS, RISK_COLORS, STATUS_COLORS, STATUS_LABELS, age, formatTime, isClosed, userName } from '../format';
import { Timeline } from '../components/Timeline';

type CaseAction = 'claim' | 'request_info' | 'resume' | 'escalate' | 'approve' | 'reject';

const ACTIONS: { action: CaseAction; label: string; icon: JSX.Element; hint: string }[] = [
  { action: 'claim', label: 'Claim', icon: <PersonAdd20Regular />, hint: 'Assign this case to yourself' },
  { action: 'request_info', label: 'Request info', icon: <Mail20Regular />, hint: 'Pause the case while waiting on the customer' },
  { action: 'resume', label: 'Info received', icon: <MailInbox20Regular />, hint: 'Customer replied; resume review' },
  { action: 'escalate', label: 'Escalate', icon: <ArrowCircleUp20Regular />, hint: 'Hand off to a senior reviewer' },
  { action: 'approve', label: 'Approve', icon: <Checkmark20Regular />, hint: 'Approve with a reason code' },
  { action: 'reject', label: 'Reject', icon: <Dismiss20Regular />, hint: 'Reject with a reason code' },
];
const ACTION_LABELS = Object.fromEntries(ACTIONS.map((a) => [a.action, a.label])) as Record<CaseAction, string>;

const useStyles = makeStyles({
  back: { marginBottom: '8px', marginLeft: '-8px' },
  header: {
    background: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: '16px 20px 12px',
    marginBottom: '12px',
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  entity: { color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.04em' },
  headerFields: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: '12px',
    marginTop: '14px',
    paddingTop: '12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  hf: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  hfLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  person: { display: 'flex', alignItems: 'center', gap: '6px' },
  overdue: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
  commandBar: {
    background: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  columns: { display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(320px, 2fr)', gap: '12px', alignItems: 'start' },
  stack: { display: 'flex', flexDirection: 'column', gap: '12px' },
  fields: { display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: '10px', columnGap: '12px', padding: '4px 4px 8px' },
  label: { color: tokens.colorNeutralForeground3 },
  ssn: { display: 'flex', alignItems: 'center', gap: '8px' },
  muted: { color: tokens.colorNeutralForeground3 },
  dialog: { display: 'flex', flexDirection: 'column', gap: '12px' },
  msg: { marginBottom: '12px' },
});

export function CaseForm({ me, users, id, onBack }: { me: User; users: User[]; id: string; onBack: () => void }) {
  const s = useStyles();
  const queryClient = useQueryClient();
  const [lostAccess, setLostAccess] = useState<CaseAction | null>(null);
  const [dialog, setDialog] = useState<CaseAction | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [showViews, setShowViews] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const caseQuery = useQuery({ queryKey: ['case', me.id, id], queryFn: () => get<KycCase>(`/cases/${id}`), staleTime: Infinity, refetchOnMount: 'always' });
  const audit = useQuery({
    queryKey: ['audit', me.id, id],
    queryFn: () => get<AuditEvent[]>(`/cases/${id}/audit`),
    enabled: !lostAccess,
  });

  const act = useMutation({
    mutationFn: (v: { action: CaseAction; note?: string; reasonCode?: string }) =>
      post<KycCase>(`/cases/${id}/actions/${v.action}`, { note: v.note || undefined, reasonCode: v.reasonCode || undefined }),
    onSuccess: (updated, v) => {
      queryClient.setQueryData(['case', me.id, id], updated);
      if (!can(me, 'case.view', updated).ok) {
        setLostAccess(v.action);
        queryClient.removeQueries({ queryKey: ['audit', me.id, id] });
      }
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setDialog(null);
    },
  });

  const reveal = useMutation({
    mutationFn: (justification: string) => post<{ ssn: string }>(`/cases/${id}/reveal-ssn`, { justification }),
    onSuccess: ({ ssn }) => {
      setRevealed(ssn);
      setRevealOpen(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setRevealed(null), 30_000);
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const backButton = (
    <Button appearance="subtle" icon={<ArrowLeft20Regular />} onClick={onBack} className={s.back}>
      Back
    </Button>
  );

  if (caseQuery.isLoading) return <Spinner label="Loading case…" />;
  if (caseQuery.error)
    return (
      <section>
        {backButton}
        <MessageBar intent="error">
          <MessageBarBody>{(caseQuery.error as Error).message}</MessageBarBody>
        </MessageBar>
      </section>
    );

  const c = caseQuery.data!;
  const a = age(c.createdAt);
  const closed = isClosed(c.status);
  const revealDecision = can(me, 'case.reveal_ssn', c);
  const events = (audit.data ?? []).filter((e) => showViews || e.action !== 'case.viewed');

  const runAction = (action: CaseAction) => {
    act.reset();
    if (action === 'claim' || action === 'resume') act.mutate({ action });
    else setDialog(action);
  };

  return (
    <section>
      {backButton}

      {lostAccess && (
        <MessageBar intent="success" className={s.msg} data-testid="access-ended">
          <MessageBarBody>
            <MessageBarTitle>{ACTION_LABELS[lostAccess]} recorded in the audit trail.</MessageBarTitle>
            You no longer have access to this case
            {c.status === 'escalated'
              ? ': it is now in the senior reviewer queue.'
              : c.status === 'pending_second_approval'
                ? ': it now needs a second approval from a different senior reviewer.'
                : '.'}
          </MessageBarBody>
          <MessageBarActions>
            <Button onClick={onBack}>Back to queue</Button>
          </MessageBarActions>
        </MessageBar>
      )}

      <div className={s.header}>
        <Text size={200} className={s.entity}>
          KYC case
        </Text>
        <div className={s.titleRow}>
          <Text as="h1" size={600} weight="semibold" style={{ margin: 0 }}>
            <span className="mono">{c.id}</span> · {c.customerName}
          </Text>
          <Badge appearance="filled" color={STATUS_COLORS[c.status]} data-testid="case-status">
            {STATUS_LABELS[c.status]}
          </Badge>
          <Badge appearance="tint" color={RISK_COLORS[c.riskLevel]}>
            {c.riskLevel} risk
          </Badge>
        </div>
        <div className={s.headerFields}>
          <HeaderField label="Owner">
            <Person users={users} id={c.assigneeId} empty="Unassigned" />
          </HeaderField>
          <HeaderField label="Risk score">
            <Text weight="semibold">{c.riskScore} / 99</Text>
          </HeaderField>
          <HeaderField label="Age (SLA 48h)">
            <Text weight="semibold" className={!closed && a.overdue ? s.overdue : undefined}>
              {a.label}
              {!closed && a.overdue ? ' · breached' : ''}
            </Text>
          </HeaderField>
          <HeaderField label="First approver">
            <Person users={users} id={c.firstApproverId} />
          </HeaderField>
          <HeaderField label="Second approver">
            <Person users={users} id={c.secondApproverId} />
          </HeaderField>
        </div>
        <StageBar c={c} />
      </div>

      <Toolbar aria-label="Case actions" className={s.commandBar}>
        {ACTIONS.map(({ action, label, icon, hint }) => {
          const d = can(me, `case.${action}` as Action, c);
          return (
            <Tooltip key={action} content={d.ok ? hint : d.reason} relationship="description" withArrow>
              <ToolbarButton
                icon={icon}
                disabledFocusable={!d.ok || act.isPending || !!lostAccess}
                onClick={() => runAction(action)}
                data-testid={`action-${action}`}
              >
                {label}
              </ToolbarButton>
            </Tooltip>
          );
        })}
        <ToolbarDivider />
        <ToolbarButton icon={<ArrowClockwise20Regular />} disabled={!!lostAccess} onClick={() => audit.refetch()}>
          Refresh
        </ToolbarButton>
      </Toolbar>

      {c.riskLevel === 'high' && !closed && (
        <MessageBar intent="warning" className={s.msg}>
          <MessageBarBody>
            <MessageBarTitle>Four-eyes rule.</MessageBarTitle>
            High-risk approvals need a second sign-off from a different senior reviewer.
          </MessageBarBody>
        </MessageBar>
      )}
      {act.error && !dialog && (
        <MessageBar intent="error" className={s.msg} data-testid="action-error">
          <MessageBarBody>{(act.error as Error).message}</MessageBarBody>
        </MessageBar>
      )}

      <div className={s.columns}>
        <div className={s.stack}>
          <Card>
            <CardHeader header={<Text weight="semibold">Customer</Text>} />
            <div className={s.fields}>
              <Text className={s.label}>Full name</Text>
              <Text>{c.customerName}</Text>
              <Text className={s.label}>Date of birth</Text>
              <Text>{c.dateOfBirth}</Text>
              <Text className={s.label}>Country</Text>
              <Text>{c.country}</Text>
              <Text className={s.label}>SSN</Text>
              <span className={s.ssn}>
                <span className="mono" data-testid="ssn">
                  {revealed ?? c.ssnMasked}
                </span>
                {revealed ? (
                  <Text size={200} className={s.muted}>
                    <LockClosed20Regular style={{ verticalAlign: 'middle' }} /> Re-masks in 30s · reveal logged
                  </Text>
                ) : (
                  <Tooltip content={revealDecision.ok ? 'Reveal is logged with your justification' : revealDecision.reason} relationship="description">
                    <Button
                      size="small"
                      icon={<Eye20Regular />}
                      disabledFocusable={!revealDecision.ok || reveal.isPending}
                      onClick={() => {
                        reveal.reset();
                        setRevealOpen(true);
                      }}
                    >
                      Reveal
                    </Button>
                  </Tooltip>
                )}
              </span>
              <Text className={s.label}>Opened</Text>
              <Text>{formatTime(c.createdAt)}</Text>
              <Text className={s.label}>Decision reason</Text>
              <Text>{c.decisionReasonCode ? REASON_LABELS[c.decisionReasonCode] : '—'}</Text>
            </div>
          </Card>

          <Card>
            <CardHeader
              header={<Text weight="semibold">Identity verification results</Text>}
              description={<Text size={200} className={s.muted}>From the IDV vendor (mocked)</Text>}
            />
            <Table size="small" aria-label="Vendor checks">
              <TableBody>
                {c.vendorChecks.map((v) => (
                  <TableRow key={v.check}>
                    <TableCell style={{ width: '38%' }}>
                      <Text weight="semibold">{v.check}</Text>
                    </TableCell>
                    <TableCell style={{ width: 90 }}>
                      <Badge appearance="tint" color={v.outcome === 'pass' ? 'success' : v.outcome === 'review' ? 'warning' : 'danger'}>
                        {v.outcome}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Text size={200}>{v.detail}</Text>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <Card>
          <CardHeader
            header={<Text weight="semibold">Timeline</Text>}
            description={<Text size={200} className={s.muted}>Append-only audit trail</Text>}
            action={<Switch label="Show views" checked={showViews} onChange={(_, d) => setShowViews(d.checked)} />}
          />
          {lostAccess ? (
            <Text className={s.muted}>Audit history is hidden because you no longer have access to this case.</Text>
          ) : audit.error ? (
            <MessageBar intent="error">
              <MessageBarBody>{(audit.error as Error).message}</MessageBarBody>
            </MessageBar>
          ) : audit.isLoading ? (
            <Spinner size="small" />
          ) : (
            <Timeline events={events} users={users} />
          )}
        </Card>
      </div>

      <ActionDialog
        key={dialog ?? 'none'}
        action={dialog}
        firstOfTwo={dialog === 'approve' && c.riskLevel === 'high' && c.status === 'in_review'}
        pending={act.isPending}
        error={act.error ? (act.error as Error).message : null}
        onClose={() => setDialog(null)}
        onSubmit={(note, reasonCode) => dialog && act.mutate({ action: dialog, note, reasonCode })}
      />
      <RevealDialog
        open={revealOpen}
        pending={reveal.isPending}
        error={reveal.error ? (reveal.error as Error).message : null}
        onClose={() => setRevealOpen(false)}
        onSubmit={(j) => reveal.mutate(j)}
      />
    </section>
  );
}

function HeaderField({ label, children }: { label: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.hf}>
      <span className={s.hfLabel}>{label}</span>
      {children}
    </div>
  );
}

function Person({ users, id, empty = '—' }: { users: User[]; id: string | null; empty?: string }) {
  const s = useStyles();
  if (!id) return <Text className={s.muted}>{empty}</Text>;
  return (
    <span className={s.person}>
      <Avatar size={24} name={userName(users, id)} color="colorful" />
      <Text weight="semibold">{userName(users, id)}</Text>
    </span>
  );
}

const useStageStyles = makeStyles({
  bar: { display: 'flex', alignItems: 'flex-start', marginTop: '14px' },
  stage: { display: 'flex', alignItems: 'flex-start', flex: 1, minWidth: 0 },
  node: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: '110px' },
  dot: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    border: `2px solid ${tokens.colorNeutralStroke1}`,
    color: tokens.colorNeutralForeground3,
    background: tokens.colorNeutralBackground1,
  },
  done: { background: tokens.colorBrandBackground, ...shorthands.borderColor(tokens.colorBrandBackground), color: tokens.colorNeutralForegroundOnBrand },
  current: { ...shorthands.borderColor(tokens.colorBrandBackground), color: tokens.colorBrandForeground1, boxShadow: `0 0 0 3px ${tokens.colorBrandBackground2}` },
  name: { fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold },
  sub: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  line: { flex: 1, height: '2px', marginTop: '12px', background: tokens.colorNeutralStroke2 },
  lineDone: { background: tokens.colorBrandBackground },
});

/** Business-process-flow style stage indicator, like Power Apps model-driven forms. */
function StageBar({ c }: { c: KycCase }) {
  const s = useStageStyles();
  const stages = c.riskLevel === 'high' ? ['New', 'In review', '2nd approval', 'Closed'] : ['New', 'In review', 'Closed'];
  const last = stages.length - 1;
  const current =
    c.status === 'new' ? 0 : c.status === 'pending_second_approval' ? 2 : isClosed(c.status) ? last : 1;
  const sub = (i: number) => {
    if (i !== current) return '';
    if (c.status === 'pending_info' || c.status === 'escalated') return STATUS_LABELS[c.status];
    if (i === last) return STATUS_LABELS[c.status];
    if (c.status === 'pending_second_approval') return 'Needs a different senior reviewer';
    return '';
  };
  return (
    <div className={s.bar} aria-label="Case stage">
      {stages.map((name, i) => {
        const done = i < current || (i === last && current === last);
        return (
          <div key={name} className={s.stage} style={i === last ? { flex: 'none' } : undefined}>
            <div className={s.node}>
              <div className={`${s.dot} ${done ? s.done : i === current ? s.current : ''}`}>{done ? <Checkmark16Filled /> : i + 1}</div>
              <span className={s.name}>{name}</span>
              <span className={s.sub}>{sub(i)}</span>
            </div>
            {i < last && <div className={`${s.line} ${i < current ? s.lineDone : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

function ActionDialog({
  action,
  firstOfTwo,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  action: CaseAction | null;
  firstOfTwo: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (note: string, reasonCode: string) => void;
}) {
  const s = useStyles();
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const codes = action === 'approve' ? APPROVE_REASON_CODES : action === 'reject' ? REJECT_REASON_CODES : null;
  const noteRequired = action === 'request_info' || action === 'escalate';
  const titles: Record<CaseAction, string> = {
    claim: 'Claim case',
    resume: 'Resume review',
    request_info: 'Request information from customer',
    escalate: 'Escalate to senior review',
    approve: 'Approve case',
    reject: 'Reject case',
  };

  return (
    <Dialog open={!!action} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(note, reasonCode);
          }}
        >
          <DialogBody>
            <DialogTitle>{action ? titles[action] : ''}</DialogTitle>
            <DialogContent className={s.dialog}>
              {codes && (
                <Field label="Reason code" required hint="Recorded on the case and in the audit trail">
                  <Select value={reasonCode} onChange={(_, d) => setReasonCode(d.value)} data-testid="reason-code">
                    <option value="">Choose a reason…</option>
                    {Object.entries(codes).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field
                label={noteRequired ? 'Note' : 'Note (optional)'}
                required={noteRequired}
                hint={action === 'escalate' ? 'Explain what the senior reviewer should look at' : undefined}
              >
                <Textarea value={note} onChange={(_, d) => setNote(d.value)} rows={3} resize="vertical" data-testid="note" />
              </Field>
              {firstOfTwo && (
                <MessageBar intent="info">
                  <MessageBarBody>This is a high-risk case: your approval is the first of two. A different senior reviewer must give the second.</MessageBarBody>
                </MessageBar>
              )}
              {error && (
                <MessageBar intent="error" data-testid="action-error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary" disabled={pending} data-testid="confirm-action">
                {pending ? 'Saving…' : action ? ACTION_LABELS[action] : ''}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

function RevealDialog({
  open,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (justification: string) => void;
}) {
  const s = useStyles();
  const [justification, setJustification] = useState('');
  useEffect(() => {
    if (open) setJustification('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (justification.trim()) onSubmit(justification.trim());
          }}
        >
          <DialogBody>
            <DialogTitle>Reveal full SSN</DialogTitle>
            <DialogContent className={s.dialog}>
              <MessageBar intent="warning">
                <MessageBarBody>Reveals are logged with your name and justification and reviewed by compliance.</MessageBarBody>
              </MessageBar>
              <Field label="Justification" required>
                <Textarea
                  value={justification}
                  onChange={(_, d) => setJustification(d.value)}
                  rows={3}
                  placeholder="e.g. Compare against SSN card in uploaded documents"
                  data-testid="reveal-justification"
                />
              </Field>
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary" disabled={pending || !justification.trim()} data-testid="confirm-reveal">
                Reveal SSN
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

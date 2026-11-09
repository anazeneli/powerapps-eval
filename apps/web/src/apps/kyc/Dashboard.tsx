import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  CardHeader,
  Link,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DonutChart, VerticalStackedBarChart } from '@fluentui/react-charts';
import { CASE_STATUSES, type KycCaseListItem as KycCase, type KycStats, type User } from '@kyc/shared';
import { get } from '../../api';
import { RISK_COLORS, STATUS_COLORS, STATUS_FILTERS, STATUS_LABELS, age, isClosed, type CaseFilter } from '../../format';
import type { Named } from '../../format';
import type { KycView as View } from './KycApp';
import { PageHeader } from '../../views/Page';

const STATUS_HEX: Record<string, string> = {
  new: '#5690CF',
  in_review: '#1F6BBA',
  pending_info: '#F2A900',
  escalated: '#D9480F',
  pending_second_approval: '#5C2E91',
  approved: '#107C10',
  rejected: '#C50F1F',
};
const RISK_HEX = { low: '#107C10', medium: '#F2A900', high: '#C50F1F' };

const useStyles = makeStyles({
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '12px' },
  kpi: { padding: '14px 16px' },
  clickable: {
    cursor: 'pointer',
    ':hover': { boxShadow: tokens.shadow8, outline: `1px solid ${tokens.colorBrandStroke2}` },
  },
  drill: { color: tokens.colorBrandForeground1, fontSize: tokens.fontSizeBase200, marginTop: '4px' },
  kpiLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  kpiValue: { fontSize: '30px', lineHeight: '38px', fontWeight: tokens.fontWeightSemibold },
  kpiNote: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  alert: { color: tokens.colorPaletteRedForeground1 },
  charts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', marginBottom: '12px' },
  lists: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '12px' },
  card: { minWidth: 0 },
  row: { cursor: 'pointer' },
  muted: { color: tokens.colorNeutralForeground3 },
  overdue: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
});

/** Measures its own width so charts redraw to fill their card as the window resizes. */
function ChartBox({ height, children }: { height: number; children: (width: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', minWidth: 0, height, overflow: 'hidden' }}>
      {width > 0 && children(width)}
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  alert,
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  const s = useStyles();
  return (
    <Card
      className={onClick ? `${s.kpi} ${s.clickable}` : s.kpi}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
      aria-label={onClick ? `${label}: open the list` : undefined}
    >
      <span className={s.kpiLabel}>{label}</span>
      <span className={`${s.kpiValue} ${alert ? s.alert : ''}`}>{value}</span>
      {note && <span className={s.kpiNote}>{note}</span>}
      {onClick && <span className={s.drill}>View cases →</span>}
    </Card>
  );
}

function CaseList({ cases, empty, onOpen }: { cases: KycCase[]; empty: string; onOpen: (id: string) => void }) {
  const s = useStyles();
  if (cases.length === 0) return <Text className={s.muted}>{empty}</Text>;
  return (
    <Table size="small">
      <TableBody>
        {cases.map((c) => {
          const a = age(c.createdAt);
          return (
            <TableRow key={c.id} className={s.row} onClick={() => onOpen(c.id)}>
              <TableCell style={{ width: 100 }} className="mono">
                {c.id}
              </TableCell>
              <TableCell>
                <Badge appearance="tint" color={STATUS_COLORS[c.status]}>
                  {STATUS_LABELS[c.status]}
                </Badge>
              </TableCell>
              <TableCell style={{ width: 90 }}>
                <Badge appearance="tint" color={RISK_COLORS[c.riskLevel]}>
                  {c.riskLevel}
                </Badge>
              </TableCell>
              <TableCell style={{ width: 80 }} className={a.overdue ? s.overdue : s.muted}>
                {a.label}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default function Dashboard({
  me,
  onOpen,
  onNavigate,
  onOpenAudit,
}: {
  me: User;
  users: Named[];
  onOpen: (id: string) => void;
  onNavigate: (v: View) => void;
  onOpenAudit?: () => void;
}) {
  const s = useStyles();
  const show = (filter: CaseFilter) => () => onNavigate({ name: 'grid', filter });
  const stats = useQuery({ queryKey: ['stats', me.id], queryFn: () => get<KycStats>('/kyc/stats') });
  const cases = useQuery({ queryKey: ['cases', me.id, 'all'], queryFn: () => get<KycCase[]>('/kyc/cases?filter=all') });

  if (stats.error)
    return (
      <MessageBar layout="multiline" intent="error">
        <MessageBarBody>{(stats.error as Error).message}</MessageBarBody>
      </MessageBar>
    );
  if (!stats.data || !cases.data)
    return (
      <Skeleton>
        <SkeletonItem size={40} style={{ marginBottom: 16, width: 300 }} />
        <SkeletonItem size={96} style={{ marginBottom: 12 }} />
        <SkeletonItem size={96} style={{ marginBottom: 12 }} />
        <SkeletonItem size={128} />
      </Skeleton>
    );

  const st = stats.data;
  const open = cases.data.filter((c) => !isClosed(c.status));
  const byAge = (a: KycCase, b: KycCase) => a.createdAt.localeCompare(b.createdAt);
  const mine = open.filter((c) => c.assigneeId === me.id).sort(byAge).slice(0, 6);
  const attention = open
    .filter((c) => age(c.createdAt).overdue || c.status === 'escalated' || c.status === 'pending_second_approval')
    .sort(byAge)
    .slice(0, 6);

  const statusData = CASE_STATUSES.filter((k) => st.byStatus[k] > 0).map((k) => ({
    legend: STATUS_LABELS[k],
    data: st.byStatus[k],
    color: STATUS_HEX[k],
    onClick: show(STATUS_FILTERS[k]),
  }));
  const riskData = (['low', 'medium', 'high'] as const).map((k) => ({
    legend: `${k[0].toUpperCase()}${k.slice(1)}`,
    data: st.byRisk[k],
    color: RISK_HEX[k],
    onClick: show(`risk_${k}`),
  }));
  const total = Object.values(st.byStatus).reduce((a, b) => a + b, 0);
  const decisions = st.decisionsByDay.map((d) => ({
    xAxisPoint: new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }),
    chartData: [
      { legend: 'Approved', data: d.approved, color: RISK_HEX.low },
      { legend: 'Rejected', data: d.rejected, color: RISK_HEX.high },
    ],
  }));

  return (
    <section>
      <PageHeader title="KYC overview" subtitle="Contoso Financial · identity verification review · last 7 days" />
      {st.scope === 'visible' && (
        <MessageBar layout="multiline" intent="info" style={{ marginBottom: 12 }}>
          <MessageBarBody>These numbers only cover cases you can access (row-level security applies to the dashboard too).</MessageBarBody>
        </MessageBar>
      )}

      <div className={s.kpis} data-testid="kpis">
        <Kpi label="Open cases" value={st.open} note={`${total} total in scope`} onClick={show('open')} />
        <Kpi label="SLA breaches (>48h)" value={st.slaBreaches} note="Open cases past SLA" alert={st.slaBreaches > 0} onClick={show('overdue')} />
        <Kpi label="Decided (7 days)" value={st.decided7d} note={st.approvalRate === null ? 'No decisions yet' : `${st.approvalRate}% approved`} onClick={show('decided_7d')} />
        <Kpi label="Avg time to decision" value={st.avgHoursToDecision === null ? '—' : `${st.avgHoursToDecision}h`} note="Case opened → final decision" onClick={show('decided_7d')} />
        <Kpi label="Awaiting 2nd approval" value={st.awaitingSecond} note="High-risk, four-eyes rule" onClick={show('second_approval')} />
        <Kpi label="Four-eyes approvals" value={st.fourEyesApprovals} note="Approved by two different reviewers" onClick={show('four_eyes')} />
        <Kpi label="SSN reveals (7 days)" value={st.ssnReveals7d} note="Each logged with a justification"
          onClick={onOpenAudit}
        />
        <Kpi label="Escalated" value={st.byStatus.escalated} note="Waiting for a senior reviewer" onClick={show('escalated')} />
      </div>

      <div className={s.charts}>
        <Card className={s.card}>
          <CardHeader header={<Text weight="semibold">Cases by status</Text>} />
          <ChartBox height={260}>
            {(w) => <DonutChart key={w} data={{ chartData: statusData }} innerRadius={55} valueInsideDonut={total} width={w} height={260} />}
          </ChartBox>
        </Card>
        <Card className={s.card}>
          <CardHeader header={<Text weight="semibold">Risk mix</Text>} />
          <ChartBox height={260}>
            {(w) => <DonutChart key={w} data={{ chartData: riskData }} innerRadius={55} valueInsideDonut={total} width={w} height={260} />}
          </ChartBox>
        </Card>
        <Card className={s.card}>
          <CardHeader
            header={<Text weight="semibold">Decisions per day</Text>}
            action={
              <Link onClick={show('decided_7d')} className={s.drill}>
                View decided cases →
              </Link>
            }
          />
          <ChartBox height={260}>
            {(w) => <VerticalStackedBarChart key={w} data={decisions} width={w} height={260} yAxisTickCount={4} />}
          </ChartBox>
        </Card>
      </div>

      <div className={s.lists}>
        <Card className={s.card}>
          <CardHeader header={<Text weight="semibold">My open cases</Text>} />
          <CaseList cases={mine} empty="Nothing assigned to you." onOpen={onOpen} />
        </Card>
        <Card className={s.card}>
          <CardHeader
            header={<Text weight="semibold">Needs attention</Text>}
            description={<Text size={200} className={s.muted}>SLA breached, escalated or awaiting 2nd approval</Text>}
          />
          <CaseList cases={attention} empty="Nothing needs attention." onOpen={onOpen} />
        </Card>
      </div>
    </section>
  );
}

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  CardHeader,
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
import { CASE_STATUSES, type KycCase, type KycStats, type User } from '@kyc/shared';
import { get } from '../api';
import { RISK_COLORS, STATUS_COLORS, STATUS_LABELS, age, isClosed } from '../format';
import { PageHeader } from './Page';

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
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px', marginBottom: '12px' },
  kpi: { padding: '14px 16px' },
  kpiLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  kpiValue: { fontSize: '30px', lineHeight: '38px', fontWeight: tokens.fontWeightSemibold },
  kpiNote: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  alert: { color: tokens.colorPaletteRedForeground1 },
  charts: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr)', gap: '12px', marginBottom: '12px' },
  lists: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px' },
  chart: { minHeight: '240px' },
  row: { cursor: 'pointer' },
  muted: { color: tokens.colorNeutralForeground3 },
  overdue: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
});

function Kpi({ label, value, note, alert }: { label: string; value: ReactNode; note?: string; alert?: boolean }) {
  const s = useStyles();
  return (
    <Card className={s.kpi}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={`${s.kpiValue} ${alert ? s.alert : ''}`}>{value}</span>
      {note && <span className={s.kpiNote}>{note}</span>}
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

export default function Dashboard({ me, onOpen }: { me: User; users: User[]; onOpen: (id: string) => void }) {
  const s = useStyles();
  const stats = useQuery({ queryKey: ['stats', me.id], queryFn: () => get<KycStats>('/stats') });
  const cases = useQuery({ queryKey: ['cases', me.id, 'all'], queryFn: () => get<KycCase[]>('/cases?filter=all') });

  if (stats.error)
    return (
      <MessageBar intent="error">
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
  }));
  const riskData = (['low', 'medium', 'high'] as const).map((k) => ({ legend: `${k[0].toUpperCase()}${k.slice(1)}`, data: st.byRisk[k], color: RISK_HEX[k] }));
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
        <MessageBar intent="info" style={{ marginBottom: 12 }}>
          <MessageBarBody>These numbers only cover cases you can access (row-level security applies to the dashboard too).</MessageBarBody>
        </MessageBar>
      )}

      <div className={s.kpis} data-testid="kpis">
        <Kpi label="Open cases" value={st.open} note={`${total} total in scope`} />
        <Kpi label="SLA breaches (>48h)" value={st.slaBreaches} note="Open cases past SLA" alert={st.slaBreaches > 0} />
        <Kpi label="Decided (7 days)" value={st.decided7d} note={st.approvalRate === null ? 'No decisions yet' : `${st.approvalRate}% approved`} />
        <Kpi label="Avg time to decision" value={st.avgHoursToDecision === null ? '—' : `${st.avgHoursToDecision}h`} note="Case opened → final decision" />
        <Kpi label="Awaiting 2nd approval" value={st.awaitingSecond} note="High-risk, four-eyes rule" />
        <Kpi label="Four-eyes approvals" value={st.fourEyesApprovals} note="Approved by two different reviewers" />
        <Kpi label="SSN reveals (7 days)" value={st.ssnReveals7d} note="Each logged with a justification" />
        <Kpi label="Escalated" value={st.byStatus.escalated} note="Waiting for a senior reviewer" />
      </div>

      <div className={s.charts}>
        <Card>
          <CardHeader header={<Text weight="semibold">Cases by status</Text>} />
          <div className={s.chart}>
            <DonutChart data={{ chartTitle: 'Cases by status', chartData: statusData }} innerRadius={55} valueInsideDonut={total} height={240} />
          </div>
        </Card>
        <Card>
          <CardHeader header={<Text weight="semibold">Risk mix</Text>} />
          <div className={s.chart}>
            <DonutChart data={{ chartTitle: 'Risk mix', chartData: riskData }} innerRadius={55} valueInsideDonut={total} height={240} />
          </div>
        </Card>
        <Card>
          <CardHeader header={<Text weight="semibold">Decisions per day</Text>} />
          <div className={s.chart}>
            <VerticalStackedBarChart data={decisions} height={240} yAxisTickCount={4} />
          </div>
        </Card>
      </div>

      <div className={s.lists}>
        <Card>
          <CardHeader header={<Text weight="semibold">My open cases</Text>} />
          <CaseList cases={mine} empty="Nothing assigned to you." onOpen={onOpen} />
        </Card>
        <Card>
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

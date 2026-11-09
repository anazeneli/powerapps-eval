import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  SearchBox,
  Skeleton,
  SkeletonItem,
  Text,
  Toolbar,
  ToolbarButton,
  createTableColumn,
  makeStyles,
  tokens,
  type TableColumnDefinition,
} from '@fluentui/react-components';
import { ArrowClockwise20Regular } from '@fluentui/react-icons';
import { SLA_HOURS, type KycCase, type User } from '@kyc/shared';
import { get } from '../../api';
import {
  RISK_COLORS,
  STATUS_COLORS,
  STATUS_LABELS,
  VIEW_LABELS,
  age,
  isClosed,
  statusOrder,
  userName,
  type CaseFilter,
} from '../../format';
import type { Named } from '../../format';
import { PageHeader, Surface } from '../../views/Page';

const useStyles = makeStyles({
  toolbar: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  search: { width: '300px' },
  row: { cursor: 'pointer' },
  owner: { display: 'flex', alignItems: 'center', gap: '8px' },
  sla: { display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', paddingRight: '12px' },
  overdue: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  empty: { padding: '32px', textAlign: 'center', color: tokens.colorNeutralForeground3 },
  count: { color: tokens.colorNeutralForeground3, marginLeft: 'auto' },
});

export function CaseGrid({
  me,
  users,
  filter,
  initialSearch,
  onOpen,
}: {
  me: User;
  users: Named[];
  filter: CaseFilter;
  initialSearch: string;
  onOpen: (id: string) => void;
}) {
  const s = useStyles();
  const [search, setSearch] = useState(initialSearch);
  const cases = useQuery({ queryKey: ['cases', me.id, filter], queryFn: () => get<KycCase[]>(`/kyc/cases?filter=${filter}`) });

  const columns: TableColumnDefinition<KycCase>[] = useMemo(
    () => [
      createTableColumn<KycCase>({
        columnId: 'id',
        compare: (a, b) => a.id.localeCompare(b.id),
        renderHeaderCell: () => 'Case',
        renderCell: (c) => <span className="mono">{c.id}</span>,
      }),
      createTableColumn<KycCase>({
        columnId: 'customer',
        compare: (a, b) => a.customerName.localeCompare(b.customerName),
        renderHeaderCell: () => 'Customer',
        renderCell: (c) => (
          <Text weight="semibold">
            {c.customerName} <span className={s.muted}>· {c.country}</span>
          </Text>
        ),
      }),
      createTableColumn<KycCase>({
        columnId: 'risk',
        compare: (a, b) => a.riskScore - b.riskScore,
        renderHeaderCell: () => 'Risk',
        renderCell: (c) => (
          <Badge appearance="tint" color={RISK_COLORS[c.riskLevel]}>
            {c.riskLevel} · {c.riskScore}
          </Badge>
        ),
      }),
      createTableColumn<KycCase>({
        columnId: 'status',
        compare: (a, b) => statusOrder(a.status) - statusOrder(b.status),
        renderHeaderCell: () => 'Status',
        renderCell: (c) => (
          <Badge appearance="tint" color={STATUS_COLORS[c.status]}>
            {STATUS_LABELS[c.status]}
          </Badge>
        ),
      }),
      createTableColumn<KycCase>({
        columnId: 'owner',
        compare: (a, b) => userName(users, a.assigneeId).localeCompare(userName(users, b.assigneeId)),
        renderHeaderCell: () => 'Owner',
        renderCell: (c) =>
          c.assigneeId ? (
            <span className={s.owner}>
              <Avatar size={20} name={userName(users, c.assigneeId)} color="colorful" />
              {userName(users, c.assigneeId)}
            </span>
          ) : (
            <span className={s.muted}>Unassigned</span>
          ),
      }),
      createTableColumn<KycCase>({
        columnId: 'sla',
        compare: (a, b) => b.createdAt.localeCompare(a.createdAt),
        renderHeaderCell: () => `Age (SLA ${SLA_HOURS}h)`,
        renderCell: (c) => {
          const a = age(c.createdAt);
          if (isClosed(c.status)) return <span className={s.muted}>Closed · {a.label}</span>;
          return (
            <div className={s.sla}>
              <Text size={200} className={a.overdue ? s.overdue : undefined}>
                {a.label}
                {a.overdue ? ' · SLA breached' : ''}
              </Text>
              <ProgressBar
                value={Math.min(a.hours / SLA_HOURS, 1)}
                thickness="large"
                color={a.overdue ? 'error' : a.hours >= SLA_HOURS * 0.75 ? 'warning' : 'brand'}
              />
            </div>
          );
        },
      }),
    ],
    [users, s],
  );

  const q = search.trim().toLowerCase();
  const rows = (cases.data ?? []).filter((c) => !q || c.id.toLowerCase().includes(q) || c.customerName.toLowerCase().includes(q));

  return (
    <section>
      <PageHeader title={VIEW_LABELS[filter]} subtitle="KYC review cases from automated identity verification exceptions" />
      {me.role === 'analyst' && (
        <MessageBar layout="multiline" intent="info" style={{ marginBottom: 12 }}>
          <MessageBarBody>Row-level access: as an analyst you see unassigned new cases and cases assigned to you.</MessageBarBody>
        </MessageBar>
      )}
      <Surface>
        <div className={s.toolbar}>
          <SearchBox className={s.search} placeholder="Filter this view" value={search} onChange={(_, d) => setSearch(d.value)} />
          <Toolbar>
            <ToolbarButton icon={<ArrowClockwise20Regular />} onClick={() => cases.refetch()}>
              Refresh
            </ToolbarButton>
          </Toolbar>
          {cases.data && (
            <Text size={200} className={s.count}>
              {rows.length} of {cases.data.length} cases
            </Text>
          )}
        </div>
        {cases.isLoading ? (
          <Skeleton>
            {Array.from({ length: 8 }, (_, i) => (
              <SkeletonItem key={i} size={32} style={{ marginBottom: 8 }} />
            ))}
          </Skeleton>
        ) : cases.error ? (
          <MessageBar layout="multiline" intent="error">
            <MessageBarBody>{(cases.error as Error).message}</MessageBarBody>
          </MessageBar>
        ) : rows.length === 0 ? (
          <div className={s.empty}>No cases in this view.</div>
        ) : (
          <DataGrid
            items={rows}
            columns={columns}
            sortable
            defaultSortState={{ sortColumn: 'sla', sortDirection: 'ascending' }}
            getRowId={(c: KycCase) => c.id}
            resizableColumns
            columnSizingOptions={{
              id: { idealWidth: 110, minWidth: 100 },
              customer: { idealWidth: 220, minWidth: 160 },
              risk: { idealWidth: 110, minWidth: 100 },
              status: { idealWidth: 170, minWidth: 150 },
              owner: { idealWidth: 160, minWidth: 120 },
              sla: { idealWidth: 200, minWidth: 160 },
            }}
            data-testid="queue-table"
          >
            <DataGridHeader>
              <DataGridRow>{({ renderHeaderCell }) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}</DataGridRow>
            </DataGridHeader>
            <DataGridBody<KycCase>>
              {({ item, rowId }) => (
                <DataGridRow<KycCase> key={rowId} className={s.row} onClick={() => onOpen(item.id)}>
                  {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>
        )}
      </Surface>
    </section>
  );
}

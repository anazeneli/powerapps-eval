import { lazy, Suspense, useState } from 'react';
import { Spinner } from '@fluentui/react-components';
import {
  ArrowCircleUp20Regular,
  CheckmarkCircle20Regular,
  Clock20Regular,
  DocumentAdd20Regular,
  DocumentBulletList20Regular,
  Home20Regular,
  PeopleTeam20Regular,
  Person20Regular,
} from '@fluentui/react-icons';
import type { Role, User } from '@kyc/shared';
import { AppShell, type NavGroup } from '../../shell/AppShell';
import { usePlatform } from '../../platform/context';
import { VIEW_LABELS, type CaseFilter } from '../../format';
import { CaseGrid } from './CaseGrid';
import { CaseForm } from './CaseForm';

const Dashboard = lazy(() => import('./Dashboard'));

export type KycView = { name: 'dashboard' } | { name: 'grid'; filter: CaseFilter } | { name: 'case'; id: string; from: KycView };

const NAV: NavGroup[] = [
  {
    header: 'My work',
    items: [
      { value: 'dashboard', label: 'Dashboard', icon: <Home20Regular /> },
      { value: 'grid:mine', label: VIEW_LABELS.mine, icon: <Person20Regular /> },
    ],
  },
  {
    header: 'Cases',
    items: (
      [
        ['all', <DocumentBulletList20Regular />],
        ['new', <DocumentAdd20Regular />],
        ['pending_info', <Clock20Regular />],
        ['escalated', <ArrowCircleUp20Regular />],
        ['second_approval', <PeopleTeam20Regular />],
        ['closed', <CheckmarkCircle20Regular />],
      ] as [CaseFilter, JSX.Element][]
    ).map(([f, icon]) => ({ value: `grid:${f}`, label: VIEW_LABELS[f], icon })),
  },
];

const navValue = (v: KycView): string => (v.name === 'case' ? navValue(v.from) : v.name === 'grid' ? `grid:${v.filter}` : 'dashboard');

export function KycApp() {
  const { me: person, users, catalog, openApp } = usePlatform();
  const me: User = { id: person.id, name: person.name, role: person.roles.kyc as Role };
  const [view, setView] = useState<KycView>({ name: 'dashboard' });
  const [search, setSearch] = useState('');
  const canAudit = !!catalog.find((a) => a.id === 'audit')?.myRole;

  const navigate = (v: KycView) => {
    if (v.name !== 'grid') setSearch('');
    setView(v);
  };
  const openCase = (id: string) => setView({ name: 'case', id, from: view.name === 'case' ? view.from : view });
  const onSearch = (q: string) => {
    const term = q.trim();
    if (/^KYC-\d+$/i.test(term)) return openCase(term.toUpperCase());
    setSearch(term);
    setView({ name: 'grid', filter: 'all' });
  };

  return (
    <AppShell
      appId="kyc"
      appName="KYC Review"
      nav={NAV}
      selected={navValue(view)}
      onSelect={(v) => navigate(v.startsWith('grid:') ? { name: 'grid', filter: v.slice(5) as CaseFilter } : { name: 'dashboard' })}
      onSearch={onSearch}
      searchPlaceholder="Search by case ID (KYC-1001) or customer"
    >
      {view.name === 'dashboard' ? (
        <Suspense fallback={<Spinner label="Loading dashboard…" />}>
          <Dashboard me={me} users={users} onOpen={openCase} onNavigate={navigate} onOpenAudit={canAudit ? () => openApp('audit') : undefined} />
        </Suspense>
      ) : view.name === 'grid' ? (
        <CaseGrid key={`${view.filter}:${search}`} me={me} users={users} filter={view.filter} initialSearch={search} onOpen={openCase} />
      ) : (
        <CaseForm key={view.id} me={me} users={users} id={view.id} onBack={() => navigate(view.from)} />
      )}
    </AppShell>
  );
}

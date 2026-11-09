import { lazy, Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@fluentui/react-components';
import type { User } from '@kyc/shared';
import { get, getUserId, setUserId } from './api';
import { AppShell, type View } from './shell/AppShell';
import { CaseGrid } from './views/CaseGrid';
import { CaseForm } from './views/CaseForm';
import { AuditLog } from './views/AuditLog';

const Dashboard = lazy(() => import('./views/Dashboard'));

export function App() {
  const queryClient = useQueryClient();
  const [userId, setUser] = useState(getUserId());
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [search, setSearch] = useState('');
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/users') });
  const me = users.data?.find((u) => u.id === userId);

  const switchUser = (id: string) => {
    setUserId(id);
    setUser(id);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'users' });
    setView({ name: 'dashboard' });
  };

  const navigate = (v: View) => {
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

  if (!me || !users.data) return <Spinner label="Loading…" style={{ marginTop: 120 }} />;

  return (
    <AppShell me={me} users={users.data} view={view} onNavigate={navigate} onSwitchUser={switchUser} onSearch={onSearch}>
      {view.name === 'dashboard' ? (
        <Suspense fallback={<Spinner label="Loading dashboard…" />}>
          <Dashboard me={me} users={users.data} onOpen={openCase} onNavigate={navigate} />
        </Suspense>
      ) : view.name === 'grid' ? (
        <CaseGrid key={`${view.filter}:${search}`} me={me} users={users.data} filter={view.filter} initialSearch={search} onOpen={openCase} />
      ) : view.name === 'case' ? (
        <CaseForm key={view.id} me={me} users={users.data} id={view.id} onBack={() => navigate(view.from)} />
      ) : (
        <AuditLog key={view.action ?? ''} users={users.data} initialAction={view.action} onOpenCase={openCase} />
      )}
    </AppShell>
  );
}

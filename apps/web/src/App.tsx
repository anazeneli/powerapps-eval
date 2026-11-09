import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type User } from '@kyc/shared';
import { get, getUserId, setUserId } from './api';
import { ROLE_LABELS } from './format';
import { Queue } from './Queue';
import { CaseDetail } from './CaseDetail';
import { AuditLog } from './AuditLog';

type View = { name: 'queue' } | { name: 'case'; id: string } | { name: 'audit' };

export function App() {
  const queryClient = useQueryClient();
  const [userId, setUser] = useState(getUserId());
  const [view, setView] = useState<View>({ name: 'queue' });
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/users') });
  const me = users.data?.find((u) => u.id === userId);

  const switchUser = (id: string) => {
    setUserId(id);
    setUser(id);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'users' });
    setView({ name: 'queue' });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">KYC Review Queue</div>
        <nav>
          <button className={view.name !== 'audit' ? 'nav active' : 'nav'} onClick={() => setView({ name: 'queue' })}>
            Queue
          </button>
          {me && can(me, 'audit.view_all').ok && (
            <button className={view.name === 'audit' ? 'nav active' : 'nav'} onClick={() => setView({ name: 'audit' })}>
              Audit log
            </button>
          )}
        </nav>
        <label className="switcher">
          Signed in as
          <select value={userId} onChange={(e) => switchUser(e.target.value)} data-testid="user-switcher">
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({ROLE_LABELS[u.role]})
              </option>
            ))}
          </select>
          <span className="mock-tag" title="Stand-in for Microsoft Entra ID sign-in">mock auth</span>
        </label>
      </header>
      <main>
        {!me ? (
          <p>Loading…</p>
        ) : view.name === 'queue' ? (
          <Queue me={me} users={users.data!} onOpen={(id) => setView({ name: 'case', id })} />
        ) : view.name === 'case' ? (
          <CaseDetail me={me} users={users.data!} id={view.id} onBack={() => setView({ name: 'queue' })} />
        ) : (
          <AuditLog users={users.data!} onOpenCase={(id) => setView({ name: 'case', id })} />
        )}
      </main>
    </div>
  );
}

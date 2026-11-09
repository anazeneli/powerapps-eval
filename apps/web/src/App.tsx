import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@fluentui/react-components';
import type { AppId, CatalogEntry, PlatformUser } from '@kyc/shared';
import { get, getUserId, setUserId } from './api';
import { PlatformContext } from './platform/context';
import { Home } from './platform/Home';
import { KycApp } from './apps/kyc/KycApp';
import { AuditApp } from './apps/audit/AuditApp';
import { AccessApp } from './apps/access/AccessApp';
import { RefundsApp } from './apps/refunds/RefundsApp';
import { FlagsApp } from './apps/flags/FlagsApp';

export function App() {
  const queryClient = useQueryClient();
  const [userId, setUser] = useState(getUserId());
  const [app, setApp] = useState<AppId | 'home'>('home');
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<PlatformUser[]>('/users') });
  const catalog = useQuery({ queryKey: ['apps', userId], queryFn: () => get<CatalogEntry[]>('/apps') });
  const me = users.data?.find((u) => u.id === userId);

  const switchUser = (id: string) => {
    setUserId(id);
    setUser(id);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'users' });
    setApp('home');
  };

  if (!me || !users.data || !catalog.data) return <Spinner label="Loading…" style={{ marginTop: 120 }} />;
  const canOpen = (id: AppId) => !!catalog.data.find((a) => a.id === id)?.myRole;
  const current = app !== 'home' && canOpen(app) ? app : 'home';

  return (
    <PlatformContext.Provider value={{ me, users: users.data, catalog: catalog.data, switchUser, openApp: setApp }}>
      {current === 'home' ? (
        <Home />
      ) : current === 'kyc' ? (
        <KycApp key={me.id} />
      ) : current === 'audit' ? (
        <AuditApp />
      ) : current === 'access' ? (
        <AccessApp />
      ) : current === 'refunds' ? (
        <RefundsApp key={me.id} />
      ) : (
        <FlagsApp />
      )}
    </PlatformContext.Provider>
  );
}

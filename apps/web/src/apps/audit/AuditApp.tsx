import { ShieldCheckmark20Regular } from '@fluentui/react-icons';
import { AppShell } from '../../shell/AppShell';
import { usePlatform } from '../../platform/context';
import { AuditLog } from './AuditLog';

export function AuditApp() {
  const { users, catalog, openApp } = usePlatform();
  const canKyc = !!catalog.find((a) => a.id === 'kyc')?.myRole;
  return (
    <AppShell
      appId="audit"
      appName="Audit Center"
      nav={[{ header: 'Audit', items: [{ value: 'log', label: 'Audit log', icon: <ShieldCheckmark20Regular /> }] }]}
      selected="log"
      onSelect={() => undefined}
    >
      <AuditLog users={users} onOpenCase={() => canKyc && openApp('kyc')} />
    </AppShell>
  );
}

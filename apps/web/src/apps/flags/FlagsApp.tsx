import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, MessageBar, MessageBarBody,
  Switch, Table, TableBody, TableCell, TableCellLayout, TableHeader, TableHeaderCell, TableRow, Text, Textarea, makeStyles,
} from '@fluentui/react-components';
import { Flag20Regular } from '@fluentui/react-icons';
import { ENVIRONMENTS, canFlag, needsApproval, type Env, type Flag, type FlagChange, type FlagRole } from '@kyc/shared';
import { get, post } from '../../api';
import { AppShell } from '../../shell/AppShell';
import { usePlatform } from '../../platform/context';
import { PageHeader, Surface } from '../../views/Page';
import { formatTime, userName } from '../../format';

const useStyles = makeStyles({ form: { display: 'flex', flexDirection: 'column', gap: '12px' }, section: { marginBottom: '20px' } });

export function FlagsApp() {
  const s = useStyles();
  const qc = useQueryClient();
  const { me: person, users } = usePlatform();
  const me = { id: person.id, name: person.name, role: person.roles.flags as FlagRole };
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => get<Flag[]>('/flags') });
  const changes = useQuery({ queryKey: ['flag-changes'], queryFn: () => get<FlagChange[]>('/flags/changes') });
  const [pending, setPending] = useState<{ flag: Flag; env: Env; enabled: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => ['flags', 'flag-changes', 'summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const change = useMutation({
    mutationFn: (v: { key: string; env: Env; enabled: boolean; reason?: string }) => post<{ applied: boolean }>(`/flags/${v.key}/change`, v),
    onSuccess: () => { setPending(null); setReason(''); refresh(); },
  });
  const decide = useMutation({ mutationFn: (v: { id: number; decision: 'approve' | 'reject' }) => post(`/flags/changes/${v.id}/${v.decision}`), onSuccess: refresh });
  const canChange = canFlag(me, 'flag.change').ok;
  const awaiting = (changes.data ?? []).filter((c) => c.status === 'pending');

  const toggle = (flag: Flag, env: Env, enabled: boolean) => {
    if (env === 'prod') setPending({ flag, env, enabled });
    else change.mutate({ key: flag.key, env, enabled });
  };

  return (
    <AppShell appId="flags" appName="Feature Flags" nav={[{ header: 'Flags', items: [{ value: 'flags', label: 'All flags', icon: <Flag20Regular /> }] }]} selected="flags" onSelect={() => undefined}>
      <PageHeader title="Feature flags" subtitle="Admin panel only; apps evaluate flags from a cached config, not from this UI. Production changes need a reason; critical flags need a release manager's approval." />
      {awaiting.length > 0 && (
        <Surface className={s.section}>
          <div style={{ padding: 16 }}>
            <Text weight="semibold" block style={{ marginBottom: 8 }}>Production changes awaiting approval</Text>
            <Table size="small" aria-label="Pending changes">
              <TableBody>
                {awaiting.map((c) => {
                  const d = canFlag(me, 'flag.decide_change', c);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="mono">{c.flagKey}</TableCell>
                      <TableCell>Turn {c.enabled ? 'ON' : 'OFF'} in prod</TableCell>
                      <TableCell>{userName(users, c.requestedBy)} · {formatTime(c.createdAt)}</TableCell>
                      <TableCell>“{c.reason}”</TableCell>
                      <TableCell>
                        <Button size="small" appearance="primary" disabled={!d.ok} title={d.ok ? undefined : d.reason} onClick={() => decide.mutate({ id: c.id, decision: 'approve' })} data-testid={`approve-change-${c.id}`}>Approve</Button>{' '}
                        <Button size="small" disabled={!d.ok} title={d.ok ? undefined : d.reason} onClick={() => decide.mutate({ id: c.id, decision: 'reject' })}>Reject</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {decide.error && <MessageBar layout="multiline" intent="error"><MessageBarBody>{(decide.error as Error).message}</MessageBarBody></MessageBar>}
          </div>
        </Surface>
      )}
      {change.error && !pending && <MessageBar layout="multiline" intent="error" style={{ marginBottom: 12 }}><MessageBarBody>{(change.error as Error).message}</MessageBarBody></MessageBar>}
      <Surface>
        <Table size="small" aria-label="Flags" data-testid="flags-table">
          <TableHeader>
            <TableRow>
              <TableHeaderCell style={{ width: '40%' }}>Flag</TableHeaderCell>
              {ENVIRONMENTS.map((e) => <TableHeaderCell key={e}>{e}</TableHeaderCell>)}
              <TableHeaderCell>Owner</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(flags.data ?? []).map((f) => (
              <TableRow key={f.key}>
                <TableCell>
                  <TableCellLayout description={f.description}>
                    <span className="mono">{f.key}</span> {f.critical && <Badge color="danger" appearance="tint" size="small">Critical</Badge>}{' '}
                    {f.pendingChange && <Badge color="warning" appearance="tint" size="small">Pending approval</Badge>}
                  </TableCellLayout>
                </TableCell>
                {ENVIRONMENTS.map((e) => (
                  <TableCell key={e}>
                    <Switch checked={f.enabled[e]} disabled={!canChange || (e === 'prod' && !!f.pendingChange)} onChange={(_, d) => toggle(f, e, d.checked)} aria-label={`${f.key} ${e}`} data-testid={`flag-${f.key}-${e}`} />
                  </TableCell>
                ))}
                <TableCell>{f.owner}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Surface>
      {pending && (
        <Dialog open onOpenChange={(_, d) => !d.open && setPending(null)}>
          <DialogSurface>
            <form noValidate onSubmit={(e) => { e.preventDefault(); change.mutate({ key: pending.flag.key, env: 'prod', enabled: pending.enabled, reason }); }}>
              <DialogBody>
                <DialogTitle>Turn {pending.enabled ? 'on' : 'off'} {pending.flag.key} in production</DialogTitle>
                <DialogContent className={s.form}>
                  {needsApproval(pending.flag, 'prod') && <MessageBar layout="multiline" intent="warning"><MessageBarBody>Critical flag: this goes to a different release manager for approval before it takes effect.</MessageBarBody></MessageBar>}
                  <Field label="Reason" required><Textarea value={reason} onChange={(_, d) => setReason(d.value)} data-testid="flag-reason" /></Field>
                  {change.error && <MessageBar layout="multiline" intent="error"><MessageBarBody>{(change.error as Error).message}</MessageBarBody></MessageBar>}
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setPending(null)}>Cancel</Button>
                  <Button type="submit" appearance="primary" disabled={change.isPending} data-testid="flag-submit">{needsApproval(pending.flag, 'prod') ? 'Request approval' : 'Apply'}</Button>
                </DialogActions>
              </DialogBody>
            </form>
          </DialogSurface>
        </Dialog>
      )}
    </AppShell>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar, Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input,
  MessageBar, MessageBarBody, Select, Table, TableBody, TableCell, TableCellLayout, TableHeader, TableHeaderCell, TableRow, Text, Textarea, makeStyles,
} from '@fluentui/react-components';
import { ArrowDownload20Regular, PeopleSettings20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { APPS, roleLabel, type AppId, type Person } from '@kyc/shared';
import { download, get, post, put } from '../../api';
import { AppShell } from '../../shell/AppShell';
import { usePlatform } from '../../platform/context';
import { PageHeader, Surface } from '../../views/Page';

const useStyles = makeStyles({ dialog: { display: 'flex', flexDirection: 'column', gap: '12px' } });

export function AccessApp() {
  const s = useStyles();
  const qc = useQueryClient();
  const { me } = usePlatform();
  const people = useQuery({ queryKey: ['people'], queryFn: () => get<Person[]>('/access/people') });
  const [edit, setEdit] = useState<{ person: Person; appId: AppId } | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['people'] });
    qc.invalidateQueries({ queryKey: ['summary'] });
  };

  return (
    <AppShell appId="access" appName="Access Admin" nav={[{ header: 'Access', items: [{ value: 'people', label: 'People & roles', icon: <PeopleSettings20Regular /> }] }]} selected="people" onSelect={() => undefined}>
      <PageHeader title="People & roles" subtitle="Grant one role per app. Every change is audited; you cannot change your own access.">
        <Button icon={<ArrowDownload20Regular />} onClick={() => download('/access/review.csv', 'access-review.csv')}>Access review CSV</Button>
        <Button appearance="primary" icon={<PersonAdd20Regular />} onClick={() => setAdding(true)} data-testid="add-person">Add person</Button>
      </PageHeader>
      <Surface>
        <div className="table-scroll">
        <Table size="small" aria-label="People" data-testid="people-table">
          <TableHeader>
            <TableRow>
              <TableHeaderCell style={{ width: 240 }}>Person</TableHeaderCell>
              {APPS.map((a) => <TableHeaderCell key={a.id}>{a.name}</TableHeaderCell>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(people.data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <TableCellLayout media={<Avatar name={p.name} size={28} color="colorful" />} description={p.title}>{p.name}{p.id === me.id ? ' (you)' : ''}</TableCellLayout>
                </TableCell>
                {APPS.map((a) => {
                  const g = p.grants.find((x) => x.appId === a.id);
                  return (
                    <TableCell key={a.id}>
                      <Button size="small" appearance={g ? 'secondary' : 'subtle'} disabled={p.id === me.id} title={p.id === me.id ? 'You cannot change your own access' : 'Change role'}
                        onClick={() => setEdit({ person: p, appId: a.id })} data-testid={`role-${p.id}-${a.id}`}>
                        {g ? <Badge appearance="tint" color="brand">{roleLabel(a.id, g.role)}</Badge> : '—'}
                      </Button>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </Surface>
      {edit && <RoleDialog person={edit.person} appId={edit.appId} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refresh(); }} />}
      {adding && <AddPersonDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
    </AppShell>
  );
}

function RoleDialog({ person, appId, onClose, onDone }: { person: Person; appId: AppId; onClose: () => void; onDone: () => void }) {
  const s = useStyles();
  const app = APPS.find((a) => a.id === appId)!;
  const current = person.grants.find((g) => g.appId === appId)?.role ?? '';
  const [role, setRole] = useState(current);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => (role ? put(`/access/people/${person.id}/roles/${appId}`, { role, reason }) : post(`/access/people/${person.id}/roles/${appId}/revoke`, { reason })),
    onSuccess: onDone,
  });
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form noValidate onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogBody>
            <DialogTitle>{person.name} · {app.name}</DialogTitle>
            <DialogContent className={s.dialog}>
              <Field label="Role">
                <Select value={role} onChange={(_, d) => setRole(d.value)} data-testid="role-select">
                  <option value="">No access</option>
                  {app.roles.map((r) => <option key={r.id} value={r.id}>{r.label}: {r.description}</option>)}
                </Select>
              </Field>
              <Field label="Reason" required hint="Recorded in the audit log, e.g. ticket number or manager approval">
                <Textarea value={reason} onChange={(_, d) => setReason(d.value)} data-testid="role-reason" />
              </Field>
              {save.error && <MessageBar layout="multiline" intent="error"><MessageBarBody>{(save.error as Error).message}</MessageBarBody></MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary" disabled={save.isPending || role === current} data-testid="role-save">{role ? 'Save role' : 'Revoke access'}</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

function AddPersonDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const s = useStyles();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const save = useMutation({ mutationFn: () => post('/access/people', { name, title }), onSuccess: onDone });
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form noValidate onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogBody>
            <DialogTitle>Add person</DialogTitle>
            <DialogContent className={s.dialog}>
              <Text size={200}>In production, people come from Microsoft Entra ID; this adds a mock directory entry. Grant app roles after adding.</Text>
              <Field label="Full name" required><Input value={name} onChange={(_, d) => setName(d.value)} data-testid="person-name" /></Field>
              <Field label="Job title" required><Input value={title} onChange={(_, d) => setTitle(d.value)} data-testid="person-title" /></Field>
              {save.error && <MessageBar layout="multiline" intent="error"><MessageBarBody>{(save.error as Error).message}</MessageBarBody></MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary" disabled={save.isPending}>Add</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

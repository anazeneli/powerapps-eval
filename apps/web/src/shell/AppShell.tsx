import { useState, type ReactNode } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Hamburger,
  Menu,
  MenuGroup,
  MenuGroupHeader,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  NavDrawer,
  NavDrawerBody,
  NavItem,
  NavSectionHeader,
  SearchBox,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowCircleUp20Regular,
  CheckmarkCircle20Regular,
  Clock20Regular,
  DocumentAdd20Regular,
  DocumentBulletList20Regular,
  GridDots24Regular,
  Home20Regular,
  PeopleTeam20Regular,
  Person20Regular,
  ShieldCheckmark20Regular,
} from '@fluentui/react-icons';
import { can, type User } from '@kyc/shared';
import { ROLE_LABELS, VIEW_LABELS, type CaseFilter } from '../format';

export type View =
  | { name: 'dashboard' }
  | { name: 'grid'; filter: CaseFilter }
  | { name: 'case'; id: string; from: View }
  | { name: 'audit' };

const CASE_VIEWS: [CaseFilter, JSX.Element][] = [
  ['all', <DocumentBulletList20Regular />],
  ['new', <DocumentAdd20Regular />],
  ['pending_info', <Clock20Regular />],
  ['escalated', <ArrowCircleUp20Regular />],
  ['second_approval', <PeopleTeam20Regular />],
  ['closed', <CheckmarkCircle20Regular />],
];

const onBrand = {
  color: tokens.colorNeutralForegroundOnBrand,
  ':hover': { color: tokens.colorNeutralForegroundOnBrand, backgroundColor: 'rgba(255,255,255,0.12)' },
  ':hover:active': { color: tokens.colorNeutralForegroundOnBrand, backgroundColor: 'rgba(255,255,255,0.2)' },
};

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100vh' },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '48px',
    padding: '0 8px 0 4px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    flexShrink: 0,
  },
  onBrand,
  title: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, whiteSpace: 'nowrap', paddingLeft: '4px' },
  org: { opacity: 0.75, fontWeight: tokens.fontWeightRegular },
  search: { margin: '0 auto', width: '380px', maxWidth: '36vw' },
  right: { display: 'flex', alignItems: 'center', gap: '8px' },
  userBtn: { ...onBrand, padding: '0 6px', textAlign: 'left' },
  userText: { display: 'flex', flexDirection: 'column', lineHeight: '1.1' },
  userRole: { fontSize: tokens.fontSizeBase100, opacity: 0.8 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  nav: { height: '100%', borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  main: { flex: 1, overflow: 'auto', padding: '20px 28px 40px' },
});

function navValue(v: View): string {
  if (v.name === 'case') return navValue(v.from);
  if (v.name === 'grid') return `grid:${v.filter}`;
  return v.name;
}

function parseNav(value: string): View {
  if (value.startsWith('grid:')) return { name: 'grid', filter: value.slice(5) as CaseFilter };
  return value === 'audit' ? { name: 'audit' } : { name: 'dashboard' };
}

export function AppShell({
  me,
  users,
  view,
  onNavigate,
  onSwitchUser,
  onSearch,
  children,
}: {
  me: User;
  users: User[];
  view: View;
  onNavigate: (v: View) => void;
  onSwitchUser: (id: string) => void;
  onSearch: (q: string) => void;
  children: ReactNode;
}) {
  const s = useStyles();
  const [navOpen, setNavOpen] = useState(true);
  const [query, setQuery] = useState('');

  return (
    <div className={s.root}>
      <header className={s.header}>
        <Hamburger className={s.onBrand} onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation" />
        <Tooltip content="App launcher: other internal apps join here in the multi-app portal" relationship="label">
          <Button appearance="transparent" className={s.onBrand} icon={<GridDots24Regular />} />
        </Tooltip>
        <div className={s.title}>
          <span className={s.org}>Contoso Financial</span> &nbsp;|&nbsp; KYC Review
        </div>
        <SearchBox
          className={s.search}
          placeholder="Search by case ID (KYC-1001) or customer"
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch(query);
          }}
        />
        <div className={s.right}>
          <Tooltip content="Stand-in for Microsoft Entra ID sign-in" relationship="description">
            <Badge color="warning" appearance="filled">
              Mock auth
            </Badge>
          </Tooltip>
          <Menu checkedValues={{ user: [me.id] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && onSwitchUser(d.checkedItems[0])}>
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="transparent" className={s.userBtn} data-testid="user-switcher" icon={<Avatar name={me.name} size={28} color="colorful" />}>
                <span className={s.userText}>
                  <span>{me.name}</span>
                  <span className={s.userRole}>{ROLE_LABELS[me.role]}</span>
                </span>
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuGroup>
                  <MenuGroupHeader>Sign in as (mock)</MenuGroupHeader>
                  {users.map((u) => (
                    <MenuItemRadio key={u.id} name="user" value={u.id} icon={<Avatar name={u.name} size={20} color="colorful" />}>
                      {u.name} · {ROLE_LABELS[u.role]}
                    </MenuItemRadio>
                  ))}
                </MenuGroup>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </header>
      <div className={s.body}>
        <NavDrawer
          open={navOpen}
          type="inline"
          className={s.nav}
          selectedValue={navValue(view)}
          onNavItemSelect={(_, d) => onNavigate(parseNav(String(d.value)))}
        >
          <NavDrawerBody>
            <NavSectionHeader>My work</NavSectionHeader>
            <NavItem value="dashboard" icon={<Home20Regular />}>
              Dashboard
            </NavItem>
            <NavItem value="grid:mine" icon={<Person20Regular />}>
              {VIEW_LABELS.mine}
            </NavItem>
            <NavSectionHeader>Cases</NavSectionHeader>
            {CASE_VIEWS.map(([filter, icon]) => (
              <NavItem key={filter} value={`grid:${filter}`} icon={icon}>
                {VIEW_LABELS[filter]}
              </NavItem>
            ))}
            {can(me, 'audit.view_all').ok && (
              <>
                <NavSectionHeader>Compliance</NavSectionHeader>
                <NavItem value="audit" icon={<ShieldCheckmark20Regular />}>
                  Audit log
                </NavItem>
              </>
            )}
          </NavDrawerBody>
        </NavDrawer>
        <main className={s.main}>{children}</main>
      </div>
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Hamburger,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
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
import { GridDots24Regular, Home20Regular } from '@fluentui/react-icons';
import { roleLabel } from '@kyc/shared';
import { usePlatform } from '../platform/context';
import { APP_ICONS } from '../platform/icons';

export interface NavEntry {
  value: string;
  label: string;
  icon: JSX.Element;
}
export interface NavGroup {
  header?: string;
  items: NavEntry[];
}

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
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    whiteSpace: 'nowrap',
    paddingLeft: '4px',
    cursor: 'pointer',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  org: { opacity: 0.75, fontWeight: tokens.fontWeightRegular, '@media (max-width: 1000px)': { display: 'none' } },
  orgSep: { '@media (max-width: 1000px)': { display: 'none' } },
  search: { margin: '0 auto', width: '380px', maxWidth: '36vw', minWidth: '120px', flexShrink: 1 },
  spacer: { margin: '0 auto' },
  right: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  mockBadge: { '@media (max-width: 760px)': { display: 'none' } },
  userBtn: { ...onBrand, padding: '0 6px', textAlign: 'left' },
  userText: { display: 'flex', flexDirection: 'column', lineHeight: '1.1', '@media (max-width: 900px)': { display: 'none' } },
  userRole: { fontSize: tokens.fontSizeBase100, opacity: 0.8 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  nav: { height: '100%', borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  main: { flex: 1, overflow: 'auto', padding: '20px 28px 40px', minWidth: 0 },
});

/** Power Apps-style frame shared by every app: header, app launcher, user menu and left navigation. */
export function AppShell({
  appId,
  appName,
  nav,
  selected,
  onSelect,
  onSearch,
  searchPlaceholder,
  children,
}: {
  appId?: string;
  appName: string;
  nav: NavGroup[];
  selected: string;
  onSelect: (value: string) => void;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  children: ReactNode;
}) {
  const s = useStyles();
  const { me, users, catalog, switchUser, openApp } = usePlatform();
  const [navOpen, setNavOpen] = useState(true);
  const [query, setQuery] = useState('');
  const myApps = catalog.filter((a) => a.myRole);
  const subtitle = appId ? roleLabel(appId, me.roles[appId as keyof typeof me.roles]) : me.title;

  return (
    <div className={s.root}>
      <header className={s.header}>
        <Hamburger className={s.onBrand} onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation" />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="Your apps" relationship="label">
              <Button appearance="transparent" className={s.onBrand} icon={<GridDots24Regular />} data-testid="app-launcher" />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<Home20Regular />} onClick={() => openApp('home')}>
                Home
              </MenuItem>
              <MenuDivider />
              <MenuGroup>
                <MenuGroupHeader>Your apps</MenuGroupHeader>
                {myApps.map((a) => (
                  <MenuItem key={a.id} icon={APP_ICONS[a.id]} onClick={() => openApp(a.id)}>
                    {a.name}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuList>
          </MenuPopover>
        </Menu>
        <div className={s.title} onClick={() => openApp('home')} title="Back to Home">
          <span className={s.org}>Contoso Financial</span>
          <span className={s.orgSep}> &nbsp;|&nbsp; </span>
          {appName}
        </div>
        {onSearch ? (
          <SearchBox
            className={s.search}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(_, d) => setQuery(d.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch(query);
            }}
          />
        ) : (
          <div className={s.spacer} />
        )}
        <div className={s.right}>
          <Tooltip content="Stand-in for Microsoft Entra ID sign-in" relationship="description">
            <Badge color="warning" appearance="filled" className={s.mockBadge}>
              Mock auth
            </Badge>
          </Tooltip>
          <Menu checkedValues={{ user: [me.id] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && switchUser(d.checkedItems[0])}>
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="transparent" className={s.userBtn} data-testid="user-switcher" icon={<Avatar name={me.name} size={28} color="colorful" />}>
                <span className={s.userText}>
                  <span>{me.name}</span>
                  <span className={s.userRole}>{subtitle}</span>
                </span>
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuGroup>
                  <MenuGroupHeader>Sign in as (mock)</MenuGroupHeader>
                  {users.map((u) => (
                    <MenuItemRadio key={u.id} name="user" value={u.id} icon={<Avatar name={u.name} size={20} color="colorful" />}>
                      {u.name} · {u.title}
                    </MenuItemRadio>
                  ))}
                </MenuGroup>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </header>
      <div className={s.body}>
        <NavDrawer open={navOpen} type="inline" className={s.nav} selectedValue={selected} onNavItemSelect={(_, d) => onSelect(String(d.value))}>
          <NavDrawerBody>
            {nav.map((g, i) => (
              <div key={g.header ?? i}>
                {g.header && <NavSectionHeader>{g.header}</NavSectionHeader>}
                {g.items.map((item) => (
                  <NavItem key={item.value} value={item.value} icon={item.icon}>
                    {item.label}
                  </NavItem>
                ))}
              </div>
            ))}
          </NavDrawerBody>
        </NavDrawer>
        <main className={s.main}>{children}</main>
      </div>
    </div>
  );
}

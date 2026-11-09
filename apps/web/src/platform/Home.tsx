import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { AppsAddIn24Regular, Home20Regular, LockClosed16Regular, Star20Filled, Star20Regular } from '@fluentui/react-icons';
import { roleLabel, type AppSummary, type CatalogEntry } from '@kyc/shared';
import { get } from '../api';
import { AppShell } from '../shell/AppShell';
import { PageHeader } from '../views/Page';
import { usePlatform } from './context';
import { APP_COLORS, APP_ICONS } from './icons';

const useStyles = makeStyles({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginBottom: '28px' },
  tile: { padding: '18px', minWidth: 0, cursor: 'pointer', ':hover': { boxShadow: tokens.shadow16 } },
  tileTop: { display: 'flex', alignItems: 'center', gap: '12px' },
  icon: {
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusLarge,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    flexShrink: 0,
  },
  name: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  star: { marginLeft: 'auto' },
  desc: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, minHeight: '36px' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: '12px' },
  metric: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  mLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100 },
  mValue: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  warning: { color: tokens.colorPaletteMarigoldForeground2 },
  danger: { color: tokens.colorPaletteRedForeground1 },
  success: { color: tokens.colorPaletteGreenForeground1 },
  section: { margin: '0 0 12px' },
  locked: { padding: '14px 18px', minWidth: 0, opacity: 0.7 },
  comingSoon: {
    padding: '18px',
    minWidth: 0,
    cursor: 'default',
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: 'none',
    color: tokens.colorNeutralForeground3,
  },
  lockLine: { display: 'flex', alignItems: 'center', gap: '6px', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

const favKey = (userId: string) => `portal.favorites.${userId}`;

function Tile({ app, favorite, onToggleFavorite }: { app: CatalogEntry; favorite: boolean; onToggleFavorite: () => void }) {
  const s = useStyles();
  const { openApp } = usePlatform();
  const summary = useQuery({ queryKey: ['summary', app.id], queryFn: () => get<AppSummary>(`/${app.id}/summary`) });
  return (
    <Card className={s.tile} onClick={() => openApp(app.id)} data-testid={`tile-${app.id}`} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openApp(app.id)}>
      <div className={s.tileTop}>
        <div className={s.icon} style={{ background: APP_COLORS[app.id] }}>
          {APP_ICONS[app.id]}
        </div>
        <div>
          <div className={s.name}>{app.name}</div>
          <Badge appearance="tint" color="brand" size="small">
            {roleLabel(app.id, app.myRole)}
          </Badge>
        </div>
        <Tooltip content={favorite ? 'Unpin' : 'Pin to top'} relationship="label">
          <Button
            className={s.star}
            appearance="subtle"
            icon={favorite ? <Star20Filled color="#F2A900" /> : <Star20Regular />}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
          />
        </Tooltip>
      </div>
      <div className={s.desc}>{app.description}</div>
      <div className={s.metrics}>
        {summary.data
          ? summary.data.metrics.slice(0, 3).map((m) => (
              <div key={m.label} className={s.metric}>
                <span className={s.mLabel}>{m.label}</span>
                <span className={`${s.mValue} ${m.tone && m.tone !== 'neutral' ? s[m.tone] : ''}`}>{m.value}</span>
              </div>
            ))
          : [0, 1, 2].map((i) => (
              <Skeleton key={i}>
                <SkeletonItem size={32} />
              </Skeleton>
            ))}
      </div>
    </Card>
  );
}

/** Placeholder for self-service app creation. Intentionally inert: it marks where the capability would live. */
function BuildYourOwnTile() {
  const s = useStyles();
  return (
    <Card className={s.comingSoon} aria-disabled="true" data-testid="tile-build-your-own">
      <div className={s.tileTop}>
        <div className={s.icon} style={{ background: tokens.colorNeutralForegroundDisabled }}>
          <AppsAddIn24Regular />
        </div>
        <div className={s.name}>Build your own app</div>
        <Badge appearance="tint" color="informative" className={s.star}>
          Coming soon
        </Badge>
      </div>
      <div className={s.desc}>Create a new internal app on the platform's shared access, audit and approvals.</div>
    </Card>
  );
}

/** Landing page: one tile per app the person has a role in, with live numbers. Others are listed as locked. */
export function Home() {
  const s = useStyles();
  const { me, catalog } = usePlatform();
  const [favorites, setFavorites] = useState<string[]>(() => JSON.parse(localStorage.getItem(favKey(me.id)) ?? '[]'));
  const toggle = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    localStorage.setItem(favKey(me.id), JSON.stringify(next));
  };
  const mine = catalog
    .filter((a) => a.myRole)
    .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const others = catalog.filter((a) => !a.myRole);
  const firstName = me.name.split(' ')[0];

  return (
    <AppShell appName="Home" nav={[{ items: [{ value: 'home', label: 'Home', icon: <Home20Regular /> }] }]} selected="home" onSelect={() => undefined}>
      <PageHeader title={`Welcome, ${firstName}`} subtitle={`${me.title} · ${mine.length} of ${catalog.length} apps available to you`} />
      {mine.length === 0 && (
        <MessageBar layout="multiline" intent="info" style={{ marginBottom: 16 }}>
          <MessageBarBody>You don't have access to any apps yet. Ask an access admin to grant you a role.</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.grid} data-testid="my-apps">
        {mine.map((a) => (
          <Tile key={a.id} app={a} favorite={favorites.includes(a.id)} onToggleFavorite={() => toggle(a.id)} />
        ))}
        <BuildYourOwnTile />
      </div>
      {others.length > 0 && (
        <>
          <Text as="h2" size={400} weight="semibold" className={s.section} block>
            Other apps in the catalog
          </Text>
          <div className={s.grid}>
            {others.map((a) => (
              <Card key={a.id} className={s.locked} data-testid={`locked-${a.id}`}>
                <div className={s.tileTop}>
                  <div className={s.icon} style={{ background: tokens.colorNeutralForeground4 }}>
                    {APP_ICONS[a.id]}
                  </div>
                  <div className={s.name}>{a.name}</div>
                </div>
                <div className={s.lockLine}>
                  <LockClosed16Regular /> No access. An access admin can grant a role.
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}

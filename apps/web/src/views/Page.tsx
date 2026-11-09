import type { ReactNode } from 'react';
import { Text, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' },
  titles: { display: 'flex', flexDirection: 'column', gap: '2px' },
  subtitle: { color: tokens.colorNeutralForeground3 },
  actions: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' },
  surface: {
    background: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: '16px',
  },
});

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.header}>
      <div className={s.titles}>
        <Text as="h1" size={600} weight="semibold" style={{ margin: 0 }}>
          {title}
        </Text>
        {subtitle && (
          <Text size={300} className={s.subtitle}>
            {subtitle}
          </Text>
        )}
      </div>
      {children && <div className={s.actions}>{children}</div>}
    </div>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  const s = useStyles();
  return <div className={className ? `${s.surface} ${className}` : s.surface}>{children}</div>;
}

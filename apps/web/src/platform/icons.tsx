import {
  ArrowUndo20Regular,
  Flag20Regular,
  PeopleSettings20Regular,
  ShieldCheckmark20Regular,
  ShieldPerson20Regular,
} from '@fluentui/react-icons';
import type { AppId } from '@kyc/shared';

export const APP_ICONS: Record<AppId, JSX.Element> = {
  kyc: <ShieldPerson20Regular />,
  refunds: <ArrowUndo20Regular />,
  flags: <Flag20Regular />,
  audit: <ShieldCheckmark20Regular />,
  access: <PeopleSettings20Regular />,
};

export const APP_COLORS: Record<AppId, string> = {
  kyc: '#1F6BBA',
  refunds: '#107C10',
  flags: '#5C2E91',
  audit: '#0E1A2B',
  access: '#C239B3',
};

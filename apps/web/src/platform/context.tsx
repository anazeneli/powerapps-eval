import { createContext, useContext } from 'react';
import type { AppId, CatalogEntry, PlatformUser } from '@kyc/shared';

export interface Platform {
  me: PlatformUser;
  users: PlatformUser[];
  catalog: CatalogEntry[];
  switchUser: (id: string) => void;
  openApp: (id: AppId | 'home') => void;
}

export const PlatformContext = createContext<Platform | null>(null);

export function usePlatform(): Platform {
  const p = useContext(PlatformContext);
  if (!p) throw new Error('PlatformContext missing');
  return p;
}

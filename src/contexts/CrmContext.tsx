import { createContext, useContext, type ReactNode } from 'react';

const CrmContext = createContext<Record<string, unknown>>({});

export function CrmProvider({ children }: { children: ReactNode }) {
  return <CrmContext.Provider value={{}}>{children}</CrmContext.Provider>;
}

export function useCrm() {
  return useContext(CrmContext);
}

import { createContext, useContext, type ReactNode } from 'react';

const CrmSettingsContext = createContext<Record<string, unknown>>({});

export function CrmSettingsProvider({ children }: { children: ReactNode }) {
  return <CrmSettingsContext.Provider value={{}}>{children}</CrmSettingsContext.Provider>;
}

export function useCrmSettings() {
  return useContext(CrmSettingsContext);
}

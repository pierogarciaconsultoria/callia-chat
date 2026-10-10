import { createContext, useContext, type ReactNode } from 'react';

const SettingsContext = createContext<Record<string, unknown>>({});

export function SettingsProvider({ children }: { children: ReactNode }) {
  return <SettingsContext.Provider value={{}}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}

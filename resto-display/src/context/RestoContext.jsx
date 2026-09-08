import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api';
import { applyAccent } from '../theme';

// Fetches GET /api/resto/context once per staff session and applies the
// property's brand_color as the accent — shared across every /staff/*
// screen via StaffShell, so the logo/color show up everywhere, not just on
// whichever screen happens to fetch context first (a real gap the earlier,
// per-screen-fetch version had: only Take Order called applyAccent).
const RestoCtx = createContext(null);

export function RestoProvider({ children }) {
  const [context, setContext] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/resto/context');
        setContext(data);
        applyAccent(data.property?.brand_color);
      } catch { /* screens below handle their own auth/module errors */ }
    })();
  }, []);

  return <RestoCtx.Provider value={context}>{children}</RestoCtx.Provider>;
}

// Returns null until loaded — callers render a loading/empty state for that.
export function useRestoContext() {
  return useContext(RestoCtx);
}

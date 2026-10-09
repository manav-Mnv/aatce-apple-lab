'use client';

import { initializeApp, getApps } from 'firebase/app';
import { GoogleAuthProvider, getAuth, onIdTokenChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { buildSessions, type Session } from '@/lib/analytics';
import type { LabData } from '@/lib/types';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};
const authEnabled = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;
const auth = authEnabled ? getAuth(getApps()[0] ?? initializeApp(firebaseConfig)) : null;

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User | null };

interface LabContext {
  /** False during server rendering: all views are live, locale-formatted client data. */
  mounted: boolean;
  auth: AuthState;
  authEnabled: boolean;
  data: LabData | null;
  sessions: Session[];
  error: string | null;
  loading: boolean;
  refresh: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<LabContext | null>(null);

export function useLab(): LabContext {
  const value = useContext(Context);
  if (!value) throw new Error('useLab must be used inside <LabProvider>');
  return value;
}

export function LabProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(authEnabled ? { status: 'loading' } : { status: 'signedIn', user: null });
  const [data, setData] = useState<LabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!auth) return;
    return onIdTokenChanged(auth, (user) => setAuthState(user ? { status: 'signedIn', user } : { status: 'signedOut' }));
  }, []);

  const signedIn = authState.status === 'signedIn';
  const user = authState.status === 'signedIn' ? authState.user : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const headers: HeadersInit = user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {};
      const response = await fetch('/api/data', { headers, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load data');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!signedIn) return;
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [signedIn, refresh]);

  const sessions = useMemo(() => (data ? buildSessions(data.entries, data.students) : []), [data]);

  const value: LabContext = {
    mounted,
    auth: authState,
    authEnabled,
    data,
    sessions,
    error,
    loading,
    refresh,
    signIn: async () => {
      if (!auth) return;
      const provider = new GoogleAuthProvider();
      const domain = process.env.NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN;
      if (domain) provider.setCustomParameters({ hd: domain });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed');
      }
    },
    signOut: async () => {
      if (auth) await signOut(auth);
      setData(null);
    }
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

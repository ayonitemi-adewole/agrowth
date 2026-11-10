import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { snapshots } from '../lib/offline/store';
import { isNetworkError } from '../lib/offline/sync';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** True until the first session check finishes. */
  loading: boolean;
  /**
   * Signed in from this phone's memory while there's no connection: the profile is the one
   * saved at the last online sign-in, and nothing can be sent until the session is back.
   */
  offline: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
  }) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const PROFILE_KEY = 'agrowth.profile';

/** The last profile seen online, so a field agent can open the app with no signal. */
function cachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function saveProfile(p: Profile | null) {
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Storage blocked (private browsing): the app works online only.
  }
}

/** The profile, or the cached one if the network is down. `offline` says which. */
async function fetchProfile(
  userId: string,
): Promise<{ profile: Profile | null; offline: boolean }> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (!error) {
    saveProfile(data as Profile);
    return { profile: data as Profile, offline: false };
  }
  const cached = cachedProfile();
  if (isNetworkError(error) && cached?.id === userId) return { profile: cached, offline: true };
  return { profile: null, offline: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let active = true;
    const apply = async (next: Session | null) => {
      let result: { profile: Profile | null; offline: boolean };
      if (next) {
        result = await fetchProfile(next.user.id);
      } else {
        // No session we can use: with no connection the token may just have expired.
        // Let the agent keep working from the phone; the session refreshes once online.
        const cached = !navigator.onLine ? cachedProfile() : null;
        result = { profile: cached, offline: !!cached };
      }
      if (!active) return;
      setSession(next);
      setProfile(result.profile);
      setOffline(result.offline);
      setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Token refreshes don't change who is signed in; skip the extra profile fetch.
      if (event === 'TOKEN_REFRESHED') {
        setSession(next);
        setOffline(false);
        return;
      }
      // Defer, so we don't call Supabase from inside its own auth callback.
      setTimeout(() => apply(next), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback<AuthState['signUp']>(async ({ email, password, fullName, phone }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone: phone || undefined } },
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    // The saved work list holds farmers' names and farm boundaries: remove it from the phone.
    // Unsent visits stay, so evidence isn't lost; they send after the same agent signs in.
    const id = cachedProfile()?.id;
    saveProfile(null);
    if (id) await snapshots.remove(id).catch(() => {});
    await supabase.auth.signOut();
    setOffline(false);
    setProfile(null);
    setSession(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session) setProfile((await fetchProfile(session.user.id)).profile);
  }, [session]);

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, offline, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** The auth state where there is one: public pages also render without a provider. */
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

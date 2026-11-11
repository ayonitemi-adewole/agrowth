import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { snapshots } from '../lib/offline/store';
import { isNetworkError } from '../lib/offline/sync';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { homePath, preloadRoute } from '../pages/lazy';

/** A sign-in, sign-out or account switch in progress, shown as a full-screen loading screen. */
export interface AuthTransition {
  kind: 'sign-in' | 'sign-out' | 'switch';
  message: string;
}

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
  /** Signs out and straight into another account, landing on that account's home screen. */
  switchAccount: (account: { email: string; password: string; label: string }) => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Set while signing in, out or switching: the app shows its loading screen meanwhile. */
  transition: AuthTransition | null;
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

/** Shortest time the sign-in / sign-out screen stays up, so it reads as a step, not a flicker. */
const MIN_TRANSITION_MS = 650;
/** Longest wait for the next screen's code before lifting the loading screen anyway. */
const PRELOAD_TIMEOUT_MS = 4000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * Signing in, out and switching are each done here as one step, behind the loading screen:
 * the session, the profile and the route all change together while it's up, and it lifts
 * once the next screen's code is downloaded. Without this, the app would render every
 * in-between state (no session yet, session but no profile, the old user's page) and visibly
 * jump between them.
 *
 * Supabase also announces each sign-in and sign-out through onAuthStateChange. While one of
 * these steps is running, those announcements are ignored (`busy`), since the step sets the
 * state itself; `generation` drops any profile fetch that finishes after a newer change.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [transition, setTransition] = useState<AuthTransition | null>(null);
  const navigate = useNavigate();
  const busy = useRef(false);
  const generation = useRef(0);
  const userId = useRef<string | null>(null);

  const commit = useCallback(
    (next: Session | null, result: { profile: Profile | null; offline: boolean }) => {
      userId.current = next?.user.id ?? result.profile?.id ?? null;
      setSession(next);
      setProfile(result.profile);
      setOffline(result.offline);
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const apply = async (next: Session | null) => {
      const gen = ++generation.current;
      let result: { profile: Profile | null; offline: boolean };
      if (next) {
        result = await fetchProfile(next.user.id);
      } else {
        // No session we can use: with no connection the token may just have expired.
        // Let the agent keep working from the phone; the session refreshes once online.
        const cached = !navigator.onLine ? cachedProfile() : null;
        result = { profile: cached, offline: !!cached };
      }
      if (!active || gen !== generation.current || busy.current) return;
      commit(next, result);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Token refreshes don't change who is signed in; skip the extra profile fetch.
      if (event === 'TOKEN_REFRESHED') {
        setSession(next);
        setOffline(false);
        return;
      }
      // A sign-in, sign-out or switch in progress sets the state itself.
      if (busy.current) return;
      // Still the same person (a user update, say): keep the profile already loaded.
      if (next && next.user.id === userId.current && event !== 'SIGNED_IN') {
        setSession(next);
        return;
      }
      // Defer, so we don't call Supabase from inside its own auth callback.
      setTimeout(() => apply(next), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [commit]);

  /** Runs `step` behind the loading screen, keeping it up at least MIN_TRANSITION_MS. */
  const behindLoadingScreen = useCallback(
    async <T,>(t: AuthTransition, step: () => Promise<T>): Promise<T> => {
      busy.current = true;
      generation.current++;
      setTransition(t);
      const started = Date.now();
      try {
        return await step();
      } finally {
        await wait(Math.max(0, MIN_TRANSITION_MS - (Date.now() - started)));
        busy.current = false;
        setTransition(null);
      }
    },
    [],
  );

  /** Signs in and loads the profile, without touching the screen state yet. */
  const authenticate = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const result = await fetchProfile(data.user.id);
    // Fetch the landing screen's code now, so it's ready when the loading screen lifts.
    await Promise.race([preloadRoute(homePath(result.profile?.role)), wait(PRELOAD_TIMEOUT_MS)]);
    return { session: data.session, result };
  }, []);

  /** Ends the session and clears what this phone keeps for the signed-in user. */
  const endSession = useCallback(async () => {
    // The saved work list holds farmers' names and farm boundaries: remove it from the phone.
    // Unsent visits stay, so evidence isn't lost; they send after the same agent signs in.
    const id = cachedProfile()?.id;
    saveProfile(null);
    if (id) await snapshots.remove(id).catch(() => {});
    await supabase.auth.signOut();
  }, []);

  const signIn = useCallback(
    (email: string, password: string) =>
      behindLoadingScreen({ kind: 'sign-in', message: 'Signing you in…' }, async () => {
        const { session: next, result } = await authenticate(email, password);
        // The sign-in page sees the session and moves on to where the user was going.
        commit(next, result);
      }),
    [behindLoadingScreen, authenticate, commit],
  );

  const signUp = useCallback<AuthState['signUp']>(
    ({ email, password, fullName, phone }) =>
      behindLoadingScreen({ kind: 'sign-in', message: 'Creating your account…' }, async () => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName, phone: phone || undefined } },
        });
        if (error) throw error;
        // Without email confirmation the new account is signed in straight away.
        if (data.session) commit(data.session, await fetchProfile(data.session.user.id));
        return { needsConfirmation: !data.session };
      }),
    [behindLoadingScreen, commit],
  );

  const signOut = useCallback(
    () =>
      behindLoadingScreen({ kind: 'sign-out', message: 'Signing you out…' }, async () => {
        await endSession();
        // Straight to the sign-in page, with no "return to" the old user's screen.
        navigate('/sign-in', { replace: true });
        commit(null, { profile: null, offline: false });
      }),
    [behindLoadingScreen, endSession, navigate, commit],
  );

  const switchAccount = useCallback<AuthState['switchAccount']>(
    (account) =>
      behindLoadingScreen(
        { kind: 'switch', message: `Switching to ${account.label}…` },
        async () => {
          await endSession();
          try {
            const { session: next, result } = await authenticate(account.email, account.password);
            navigate(homePath(result.profile?.role), { replace: true });
            commit(next, result);
          } catch (err) {
            navigate('/sign-in', { replace: true });
            commit(null, { profile: null, offline: false });
            throw err;
          }
        },
      ),
    [behindLoadingScreen, endSession, authenticate, navigate, commit],
  );

  const refreshProfile = useCallback(async () => {
    if (session) setProfile((await fetchProfile(session.user.id)).profile);
  }, [session]);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        offline,
        signIn,
        signUp,
        signOut,
        switchAccount,
        refreshProfile,
        transition,
      }}
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

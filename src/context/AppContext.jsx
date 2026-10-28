import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { DEFAULT_ACCENT, readableTextOn } from '../lib/color';
import { useMediaQuery } from '../hooks/useMediaQuery';

const AppContext = createContext(null);

const readStorage = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode); preferences still live in Firestore
  }
};

export const AppProvider = ({ children }) => {
  const [user, setUser] = useState(auth.currentUser);
  const [userVersion, setUserVersion] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [themePreference, setThemePreference] = useState(() => readStorage('theme', 'light'));
  const [accent, setAccent] = useState(() => readStorage('accent', DEFAULT_ACCENT));

  useEffect(
    () =>
      onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthReady(true);
      }),
    []
  );

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return undefined;
    }
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setProfile(data);
        if (data.theme) setThemePreference(data.theme);
        if (data.accent) setAccent(data.accent);
      },
      (error) => console.error('Error loading profile:', error)
    );
  }, [user]);

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = themePreference === 'system' ? (prefersDark ? 'dark' : 'light') : themePreference;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a110f' : accent);
    writeStorage('theme', themePreference);
  }, [theme, themePreference, accent]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', readableTextOn(accent));
    writeStorage('accent', accent);
  }, [accent]);

  // updateProfile() mutates the same User object, so bump a version to re-render consumers
  const reloadUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    setUser(auth.currentUser);
    setUserVersion((v) => v + 1);
  }, []);

  // Applies immediately, then persists so every device picks it up
  const updateAppearance = useCallback(async (changes) => {
    if (changes.theme) setThemePreference(changes.theme);
    if (changes.accent) setAccent(changes.accent);
    if (auth.currentUser) await updateDoc(doc(db, 'users', auth.currentUser.uid), changes);
  }, []);

  const value = useMemo(
    () => ({
      user,
      authReady,
      profile,
      profileLoading: Boolean(user) && profile === null,
      availableBalance: Number(profile?.availableBalance) || 0,
      investmentBalance: Number(profile?.investmentBalance) || 0,
      displayName: profile?.firstName || user?.displayName || 'there',
      theme,
      themePreference,
      setThemePreference,
      accent,
      setAccent,
      updateAppearance,
      reloadUser,
      userVersion,
    }),
    [user, authReady, profile, theme, themePreference, accent, updateAppearance, reloadUser, userVersion]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>');
  return context;
};

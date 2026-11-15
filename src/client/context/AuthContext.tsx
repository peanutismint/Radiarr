import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthStatusResponse, UserProfile, UserRole } from '../../shared/types.ts';
import { apiFetch, getStoredAuthToken, setStoredAuthToken } from '../utils/apiInterceptor.ts';

interface AuthContextValue {
  user: UserProfile | null;
  authEnabled: boolean;
  hasAdminUser: boolean;
  loading: boolean;
  isAdmin: boolean;
  isCurator: boolean;
  isListener: boolean;
  canEditStations: boolean;
  canAccessSettings: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setupInitialAdmin: (username: string, password: string) => Promise<void>;
  toggleAuth: (enabled: boolean) => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authEnabled, setAuthEnabled] = useState<boolean>(false);
  const [hasAdminUser, setHasAdminUser] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/status');

      if (res.ok) {
        const data: AuthStatusResponse = await res.json();
        setAuthEnabled(Boolean(data.authEnabled));
        setHasAdminUser(Boolean(data.hasAdminUser));
        if (data.user) {
          setUser(data.user);
        } else {
          // If authentication is on and session is invalid, clear stale stored token
          if (data.authEnabled) {
            setStoredAuthToken(null);
          }
          setUser(null);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch auth status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAuthStatus();
  }, [fetchAuthStatus]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Invalid username or password');
    }

    const data: { user: UserProfile; token?: string } = await res.json();
    if (data.token) {
      setStoredAuthToken(data.token);
    }
    setUser(data.user);
    await fetchAuthStatus();
  }, [fetchAuthStatus]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredAuthToken(null);
      setUser(null);
      await fetchAuthStatus();
    }
  }, [fetchAuthStatus]);

  const setupInitialAdmin = useCallback(async (username: string, password: string) => {
    const res = await apiFetch('/api/auth/setup-initial-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to setup administrator');
    }

    const data: { user: UserProfile; token?: string } = await res.json();
    if (data.token) {
      setStoredAuthToken(data.token);
    }
    setUser(data.user);
    setAuthEnabled(true);
    setHasAdminUser(true);
    await fetchAuthStatus();
  }, [fetchAuthStatus]);

  const toggleAuth = useCallback(async (enabled: boolean) => {
    const res = await apiFetch('/api/auth/toggle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });


    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to toggle authentication');
    }

    setAuthEnabled(enabled);
    await fetchAuthStatus();
  }, [fetchAuthStatus]);

  const role: UserRole = user?.role || (authEnabled ? 'listener' : 'admin');
  const isAdmin = !authEnabled || role === 'admin';
  const isCurator = authEnabled && role === 'curator';
  const isListener = authEnabled && role === 'listener';
  const canEditStations = !authEnabled || role === 'admin' || role === 'curator';
  const canAccessSettings = !authEnabled || role === 'admin';

  const value = useMemo(
    () => ({
      user,
      authEnabled,
      hasAdminUser,
      loading,
      isAdmin,
      isCurator,
      isListener,
      canEditStations,
      canAccessSettings,
      login,
      logout,
      setupInitialAdmin,
      toggleAuth,
      refreshAuth: fetchAuthStatus,
    }),
    [
      user,
      authEnabled,
      hasAdminUser,
      loading,
      isAdmin,
      isCurator,
      isListener,
      canEditStations,
      canAccessSettings,
      login,
      logout,
      setupInitialAdmin,
      toggleAuth,
      fetchAuthStatus,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

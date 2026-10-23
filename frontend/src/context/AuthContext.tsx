import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, type UserProfile } from '../services/api.client';
import { useToast } from './ToastContext';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
  loginWithGoogle: () => void;
  loginWithDev: (email?: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const { error: toastError, success: toastSuccess } = useToast();

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await api.getCurrentUser();
      setUser(profile);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check session on mount
    void refreshProfile();
  }, [refreshProfile]);

  const loginWithGoogle = () => {
    // Redirect browser to backend Google OAuth initiation endpoint
    window.location.href = api.getGoogleLoginUrl();
  };

  const loginWithDev = async (email?: string, name?: string) => {
    setLoading(true);
    try {
      const loggedUser = await api.devLogin(email, name);
      setUser(loggedUser);
      toastSuccess('Welcome to ReachInbox', `Signed in as ${loggedUser.name || loggedUser.email}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      toastError('Authentication Failed', message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await api.logout();
      setUser(null);
      toastSuccess('Signed Out', 'You have been successfully signed out.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign out failed';
      toastError('Sign Out Error', message);
      // Still clear local state on error
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        loginWithGoogle,
        loginWithDev,
        logout,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

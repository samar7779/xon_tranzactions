'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, setToken } from './api';

export interface AdminUser {
  id: string;
  email: string;
  fullName?: string | null;
  role: 'SUPERADMIN' | 'ADMIN' | 'VIEWER';
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      async login(email, password) {
        const data = await api.post<{ token: string; user: AdminUser }>(
          '/auth/login',
          { email, password },
          { auth: false },
        );
        setToken(data.token);
        set({ token: data.token, user: data.user });
      },
      logout() {
        setToken(null);
        set({ token: null, user: null });
      },
      async hydrate() {
        const token = get().token;
        if (!token) return;
        setToken(token);
        try {
          const me = await api.get<AdminUser>('/auth/me');
          set({ user: me });
        } catch {
          setToken(null);
          set({ token: null, user: null });
        }
      },
    }),
    { name: 'xt_auth', partialize: (s) => ({ token: s.token, user: s.user }) },
  ),
);

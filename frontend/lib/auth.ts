'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, setToken } from './api';

export interface AdminUser {
  id: string;
  email: string;
  fullName?: string | null;
  role?: string | null;
  roleId?: string | null;
  roleLabel?: string | null;
  permissions: string[];
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  /** zustand persist localStorage'dan o'qib bo'lganini bildiradi */
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
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
      // Ruxsat faqat foydalanuvchining roliga berilgan permissions[] dan tekshiriladi.
      hasPermission(perm: string) {
        const u = get().user;
        if (!u) return false;
        return u.permissions?.includes(perm) ?? false;
      },
    }),
    {
      name: 'xt_auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** UI helper — komponentda ishlatish uchun. Ruxsat faqat roldan. */
export function useHasPermission(perm: string) {
  return useAuth((s) => {
    if (!s.user) return false;
    return s.user.permissions?.includes(perm) ?? false;
  });
}

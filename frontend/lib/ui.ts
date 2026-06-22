'use client';

import { create } from 'zustand';

interface UIState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  antiStressOpen: boolean;
  setAntiStressOpen: (open: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  antiStressOpen: false,
  setAntiStressOpen: (open) => set({ antiStressOpen: open }),
}));

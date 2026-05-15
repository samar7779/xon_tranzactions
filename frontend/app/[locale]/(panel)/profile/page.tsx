'use client';

import { useQuery } from '@tanstack/react-query';
import {
  UserCircle, Mail, Shield, ShieldCheck, KeyRound, Clock, Hash,
  CheckCircle2, Sparkles,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Topbar } from '@/components/topbar';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

interface MeResponse {
  id: string;
  email: string;
  fullName?: string | null;
  role?: string | null;
  roleId?: string | null;
  roleLabel?: string | null;
  permissions: string[];
  lastLoginAt?: string | null;
}

const PERM_GROUP_LABEL: Record<string, { label: string; color: string }> = {
  dashboard:   { label: 'Boshqaruv paneli', color: 'from-indigo-500 to-blue-600' },
  transactions:{ label: 'Tranzaksiyalar',   color: 'from-emerald-500 to-teal-600' },
  accounts:    { label: 'Hisoblar',         color: 'from-cyan-500 to-sky-600' },
  credentials: { label: 'Bank ulanishlari', color: 'from-violet-500 to-purple-600' },
  banks:       { label: 'Banklar',          color: 'from-blue-500 to-indigo-600' },
  sync:        { label: 'Sinxronlash',      color: 'from-amber-500 to-orange-600' },
  users:       { label: 'Adminlar',         color: 'from-rose-500 to-pink-600' },
  roles:       { label: 'Rollar',           color: 'from-fuchsia-500 to-purple-600' },
  system:      { label: 'Tizim',            color: 'from-slate-600 to-slate-800' },
  customers:   { label: 'Mijozlar',         color: 'from-lime-500 to-emerald-600' },
  contracts:   { label: 'Shartnomalar',     color: 'from-orange-500 to-rose-600' },
  payments:    { label: "To'lovlar",        color: 'from-green-500 to-emerald-600' },
};

const ACTION_LABEL: Record<string, string> = {
  view: "Ko'rish",
  manage: 'Boshqaruv',
  test: 'Test',
  run: 'Ishga tushirish',
  deploy: 'Deploy',
};

export default function ProfilePage() {
  const cachedUser = useAuth((s) => s.user);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 30_000,
  });

  const user = me || (cachedUser as any as MeResponse | null);

  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();
  const permissions = user?.permissions || [];

  const grouped = permissions.reduce<Record<string, string[]>>((acc, p) => {
    const [resource, action] = p.split(':');
    if (!acc[resource]) acc[resource] = [];
    acc[resource].push(action || p);
    return acc;
  }, {});

  return (
    <>
      <Topbar title="Profilim" subtitle="Mening hisobim va ruxsatlarim" />

      <div className="flex-1 p-6 lg:p-8 w-full">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Hero card */}
          <Card className="border-0 shadow-soft overflow-hidden">
            <div className="relative bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 px-8 py-10 text-white overflow-hidden">
              <div className="absolute inset-0 bg-dots opacity-10 pointer-events-none" />
              <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -left-10 w-72 h-72 rounded-full bg-violet-300/15 blur-3xl pointer-events-none" />

              <div className="relative flex items-center gap-6">
                <div className="relative shrink-0">
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-white/40 to-white/10 ring-2 ring-white/40 backdrop-blur-md grid place-items-center text-white text-4xl font-black shadow-2xl">
                    {initial}
                  </div>
                  <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-400 ring-4 ring-indigo-600 grid place-items-center">
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 text-white/80 text-[11px] uppercase tracking-[0.18em] font-bold">
                    <Sparkles className="h-3 w-3" />
                    Mening hisobim
                  </div>
                  <div className="text-3xl font-black tracking-tight truncate">
                    {user?.fullName || user?.email || '—'}
                  </div>
                  <div className="text-white/85 mt-1 text-sm truncate flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    {user?.email}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-xs font-semibold">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {user?.roleLabel || user?.role || '—'}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Info grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              icon={<Hash className="h-4 w-4" />}
              gradient="from-slate-500 to-slate-700"
              label="Foydalanuvchi ID"
              value={user?.id ? user.id.slice(0, 8) + '…' : '—'}
              mono
            />
            <StatCard
              icon={<Shield className="h-4 w-4" />}
              gradient="from-violet-500 to-purple-600"
              label="Rol"
              value={user?.roleLabel || user?.role || '—'}
            />
            <StatCard
              icon={<Clock className="h-4 w-4" />}
              gradient="from-emerald-500 to-teal-600"
              label="Oxirgi kirish"
              value={user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}
              small
            />
          </div>

          {/* Permissions */}
          <Card className="border-0 shadow-soft overflow-hidden">
            <div className="bg-gradient-to-br from-slate-50 to-white px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-1 text-slate-500">
                <KeyRound className="h-3.5 w-3.5" />
                <span className="text-[10px] uppercase tracking-[0.15em] font-bold">Ruxsatlar</span>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-lg font-bold tracking-tight text-slate-800">
                    Sizning rolingiz uchun berilgan ruxsatlar
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Tizimning qaysi bo'limlariga kira olasiz va nima qila olasiz
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-3xl font-black tracking-tight bg-gradient-to-br from-indigo-600 to-violet-600 bg-clip-text text-transparent leading-none">
                    {permissions.length}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-1">ta ruxsat</div>
                </div>
              </div>
            </div>

            <CardContent className="p-6">
              {permissions.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-500">
                  Sizga hech qanday ruxsat berilmagan
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(grouped).map(([resource, actions]) => {
                    const meta = PERM_GROUP_LABEL[resource] || { label: resource, color: 'from-slate-400 to-slate-600' };
                    return (
                      <div
                        key={resource}
                        className="group relative rounded-xl bg-white ring-1 ring-slate-200 hover:ring-indigo-200 hover:shadow-md transition-all overflow-hidden"
                      >
                        <div className={cn('h-1 bg-gradient-to-r', meta.color)} />
                        <div className="p-3.5">
                          <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-1">
                            {resource}
                          </div>
                          <div className="text-sm font-bold text-slate-800 mb-2.5 truncate">{meta.label}</div>
                          <div className="flex flex-wrap gap-1">
                            {actions.map((a) => (
                              <span
                                key={a}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 text-[10px] font-semibold ring-1 ring-slate-200"
                              >
                                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                                {ACTION_LABEL[a] || a}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tip */}
          <div className="rounded-xl bg-indigo-50/60 ring-1 ring-indigo-100 px-4 py-3 flex items-start gap-2.5">
            <UserCircle className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-[12px] text-indigo-900 leading-relaxed">
              <b>Ma'lumotlarni o'zgartirish?</b> Ism yoki rolni faqat <b>SUPERADMIN</b> tizim adminlari sahifasidan o'zgartira oladi.
              Parolingizni o'zgartirish kerak bo'lsa, admin bilan bog'laning.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon, gradient, label, value, mono, small,
}: {
  icon: React.ReactNode;
  gradient: string;
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className={cn('h-1 bg-gradient-to-r', gradient)} />
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-slate-500 mb-1.5">
          <div className={cn('w-7 h-7 rounded-lg bg-gradient-to-br grid place-items-center text-white shrink-0', gradient)}>
            {icon}
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold">{label}</div>
        </div>
        <div
          className={cn(
            'font-bold text-slate-800 truncate',
            small ? 'text-sm' : 'text-base',
            mono && 'font-mono',
          )}
          title={value}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

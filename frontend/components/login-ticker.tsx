'use client';

/**
 * Login sahifasi pastida real-time tranzaksiya lentasi.
 * Chap-o'ngga sekin harakatlanadi, banklar, summalar, vaqtlar bilan.
 */
export function LoginTicker() {
  // Bir nechta dummy tranzaksiya — dublikat qilamiz seamless loop uchun
  const items = [
    { bank: 'Kapitalbank', who: 'ABU SAHIY MCHJ', amount: '+18.5M', dir: 'in' as const },
    { bank: "Ipak Yo'li",   who: 'LEVEL UP-STROY', amount: '+5.5M', dir: 'in' as const },
    { bank: 'Kapitalbank', who: "Soliq to'lovi", amount: '−4.8M', dir: 'out' as const },
    { bank: 'Kapitalbank', who: 'SHIRIN HAYOT RESIDENCE', amount: '+60M', dir: 'in' as const },
    { bank: "Ipak Yo'li",   who: 'KORPORATIV', amount: '−1.5M', dir: 'out' as const },
    { bank: 'Kapitalbank', who: 'TARIF Service', amount: '−1 000', dir: 'out' as const },
    { bank: "Ipak Yo'li",   who: 'XON BUILDERS', amount: '+22.4M', dir: 'in' as const },
    { bank: 'Kapitalbank', who: 'Yangi mijoz', amount: '+8.2M', dir: 'in' as const },
  ];
  // Seamless loop uchun ro'yxatni 2 marta render qilamiz
  const doubled = [...items, ...items];

  return (
    <div className="relative overflow-hidden bg-black/30 border-y border-cyan-400/20 backdrop-blur-sm">
      {/* Chap va o'ng fade */}
      <div className="absolute left-0 top-0 bottom-0 w-24 z-10 pointer-events-none
                      bg-gradient-to-r from-[#0a162e] to-transparent" />
      <div className="absolute right-0 top-0 bottom-0 w-24 z-10 pointer-events-none
                      bg-gradient-to-l from-[#0a162e] to-transparent" />

      <div className="flex gap-12 whitespace-nowrap py-3 login-ticker-scroll">
        {doubled.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-2 text-[12px] font-mono px-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
            <span className="text-cyan-200/70">{it.bank}</span>
            <span className="text-white/40">·</span>
            <span className="text-white/60">{it.who}</span>
            <span className={
              it.dir === 'in'
                ? 'text-emerald-400 font-bold'
                : 'text-rose-400 font-bold'
            }>
              {it.amount}
            </span>
          </span>
        ))}
      </div>

      <style jsx>{`
        @keyframes login-ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .login-ticker-scroll {
          animation: login-ticker-scroll 50s linear infinite;
        }
      `}</style>
    </div>
  );
}

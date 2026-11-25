// Wishes («ønsker») on screen: the counter in the header, the panel that
// explains them and sells more, and the list of what a login gives.
// What a wish is and what it costs lives in types.ts; the server counts them
// (api/_lib/access.ts) — this only shows the numbers.
import React, { useEffect, useState } from 'react';
import {
  MAX_WISHES_PER_PURCHASE,
  PLAN_NAMES,
  PRICE_PRINSEN_PER_WEEK_KR,
  Plan,
  WISHES_PER_WEEK,
  WISH_PRICE_KR,
  Wishes,
  wishCount,
  wishTotal,
} from '../types';
import { logEvent } from '../services/analytics';
import { BookOpen, Camera, Check, Loader2, Minus, Pencil, Plus, Star, Volume2, X } from 'lucide-react';

// "2026-12-31" -> "31. desember"
export const niceDate = (date: string): string => {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' }).format(d);
};

// What a wish can be used on. Each costs one.
export const WISH_USES: { icon: React.ReactNode; label: string; note?: string }[] = [
  { icon: <BookOpen className="w-5 h-5" />, label: 'En historie' },
  { icon: <Camera className="w-5 h-5" />, label: 'En ny helt fra et bilde', note: 'Gratis å bruke igjen' },
  { icon: <Pencil className="w-5 h-5" />, label: 'En ny egen lærepenge', note: 'Gratis å bruke igjen' },
  { icon: <Volume2 className="w-5 h-5" />, label: 'Opplesning av en historie', note: 'Gjelder hele historien' },
];

// The counter in the header: a star and how many wishes are left.
export const WishPill: React.FC<{ wishes: Wishes; onClick: () => void }> = ({ wishes, onClick }) => {
  const total = wishTotal(wishes);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Du har ${wishCount(total)}. Se ønskene dine`}
      className={`inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${
        total > 0
          ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-400/20 dark:text-amber-100 dark:hover:bg-amber-400/30'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
    >
      <Star
        className={`w-4 h-4 shrink-0 ${total > 0 ? 'fill-amber-400 text-amber-500' : 'text-gray-400'}`}
        aria-hidden="true"
      />
      <span>{total}</span>
      <span className="hidden sm:inline font-semibold">{total === 1 ? 'ønske' : 'ønsker'}</span>
    </button>
  );
};

// This week's wishes as stars: the ones left are filled, the used ones hollow.
const WeekStars: React.FC<{ left: number; total: number }> = ({ left, total }) => (
  <span className="flex flex-wrap gap-1" aria-hidden="true">
    {Array.from({ length: total }, (_, i) => (
      <Star
        key={i}
        className={`w-5 h-5 ${i < left ? 'fill-amber-400 text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}
      />
    ))}
  </span>
);

interface WishPanelProps {
  wishes: Wishes;
  plan: Plan | null;
  // Prinsen as a gift lasts through this day.
  giftUntil: string | null;
  // Extra wishes can be bought with Vipps.
  canBuy: boolean;
  // Goes to Vipps. Resolves to an error message if that failed.
  onBuy: (count: number) => Promise<string | null>;
  // The way to the plan page. Left out while a story is on screen.
  onOpenPlan?: () => void;
  onClose: () => void;
}

// Everything about the wishes in one place: how many, where they come from,
// what they are used on, and how to get more.
export const WishPanel: React.FC<WishPanelProps> = ({
  wishes,
  plan,
  giftUntil,
  canBuy,
  onBuy,
  onOpenPlan,
  onClose,
}) => {
  const isPro = plan === 'pro';
  const price = WISH_PRICE_KR[isPro ? 'pro' : 'gratis'];
  const total = wishTotal(wishes);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const buy = async () => {
    setBusy(true);
    setBuyError(null);
    const failed = await onBuy(count);
    // On the way to Vipps the button stays busy until the page is left.
    if (failed) {
      setBuyError(failed);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onsker-tittel"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-gray-800 border-2 border-amber-100 dark:border-amber-900/60 shadow-2xl p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Lukk"
          className="absolute top-3 right-3 inline-flex items-center justify-center w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center">
          <Star className="mx-auto w-10 h-10 fill-amber-400 text-amber-500" aria-hidden="true" />
          <h2 id="onsker-tittel" className="mt-2 text-2xl font-extrabold text-gray-900 dark:text-gray-100">
            Du har {wishCount(total)}
          </h2>
        </div>

        {/* Where they come from */}
        <dl className="mt-5 divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
          <div className="flex items-center justify-between gap-4 py-3">
            <dt>
              <span className="block font-semibold text-gray-900 dark:text-gray-100">Ukas ønsker</span>
              <span className="block text-sm text-gray-500 dark:text-gray-400">
                {wishes.week} av {wishes.weekTotal} igjen · nye på mandag
              </span>
            </dt>
            <dd>
              <WeekStars left={wishes.week} total={wishes.weekTotal} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt>
              <span className="block font-semibold text-gray-900 dark:text-gray-100">Kjøpte ønsker</span>
              <span className="block text-sm text-gray-500 dark:text-gray-400">Varer til de er brukt</span>
            </dt>
            <dd className="text-lg font-bold text-gray-900 dark:text-gray-100">{wishes.bought}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Ukas ønsker brukes først.</p>

        {/* What they are used on */}
        <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Et ønske gir deg
        </h3>
        <ul className="mt-2 space-y-2">
          {WISH_USES.map((use) => (
            <li key={use.label} className="flex items-center gap-3 text-gray-800 dark:text-gray-100">
              <span className="shrink-0 text-indigo-500 dark:text-indigo-300">{use.icon}</span>
              <span className="leading-snug">
                <span className="font-semibold">{use.label}</span>
                {use.note && <span className="block text-xs text-gray-500 dark:text-gray-400">{use.note}</span>}
              </span>
            </li>
          ))}
        </ul>

        {/* More wishes */}
        <div className="mt-6 rounded-2xl bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/30 p-4">
          <p className="font-bold text-gray-900 dark:text-gray-100">
            Flere ønsker · {price} kr per ønske
          </p>
          {canBuy ? (
            <>
              <div className="mt-3 flex items-center gap-3">
                <div className="inline-flex items-center rounded-full border-2 border-amber-300 dark:border-amber-500/50 bg-white dark:bg-gray-900">
                  <button
                    type="button"
                    onClick={() => setCount((c) => Math.max(1, c - 1))}
                    disabled={busy || count <= 1}
                    aria-label="Færre ønsker"
                    className="w-10 h-10 inline-flex items-center justify-center rounded-full disabled:opacity-40"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center text-lg font-bold" aria-live="polite">
                    {count}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCount((c) => Math.min(MAX_WISHES_PER_PURCHASE, c + 1))}
                    disabled={busy || count >= MAX_WISHES_PER_PURCHASE}
                    aria-label="Flere ønsker"
                    className="w-10 h-10 inline-flex items-center justify-center rounded-full disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={buy}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#FF5B24] text-[#1A0B05] font-bold py-2.5 px-4 hover:bg-[#FF7445] disabled:opacity-70 transition-colors"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Kjøp for {count * price} kr
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">Betales med Vipps.</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Kjøp av ønsker kommer snart.</p>
          )}
          {buyError && (
            <p role="alert" className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">
              {buyError}
            </p>
          )}
        </div>

        {isPro ? (
          giftUntil && (
            <p className="mt-4 text-sm text-center text-gray-600 dark:text-gray-300">
              Du er {PLAN_NAMES.pro} til og med {niceDate(giftUntil)}.
            </p>
          )
        ) : (
          <p className="mt-4 text-sm text-center text-gray-600 dark:text-gray-300">
            Som {PLAN_NAMES.pro} får du {wishCount(WISHES_PER_WEEK.pro)} hver uke for {PRICE_PRINSEN_PER_WEEK_KR} kr,
            og ekstra ønsker til {WISH_PRICE_KR.pro} kr.
            {onOpenPlan && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={onOpenPlan}
                  className="font-semibold text-indigo-600 dark:text-indigo-300 underline underline-offset-4"
                >
                  Se {PLAN_NAMES.pro}
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
};

// What a login gives. Shown to visitors without one: under the start button,
// when their one story is used, and when they want to save a story.
const LOGIN_BENEFITS = [
  `${wishCount(WISHES_PER_WEEK.gratis)} hver uke – helt gratis`,
  'Lagre eventyrene og les dem igjen',
  'Lag en egen helt av kosedyret',
  'Skriv deres egen lærepenge',
  'Få historien lest opp',
];

export const LoginBenefits: React.FC<{
  title?: string;
  // Vipps login is set up.
  canLogIn: boolean;
  // Something to do before leaving for Vipps (keep the story on screen).
  // Without it the button is a plain link to the login.
  onLogin?: () => void;
  busy?: boolean;
  className?: string;
}> = ({ title = 'Logg inn og få mer', canLogIn, onLogin, busy, className = '' }) => {
  const button =
    'mt-5 flex w-full justify-center items-center gap-2 rounded-full bg-[#FF5B24] text-[#1A0B05] text-lg font-bold py-3.5 px-6 shadow-lg hover:bg-[#FF7445] disabled:opacity-70 transition-colors';
  return (
    <div
      className={`rounded-2xl border-2 border-emerald-200 dark:border-emerald-400/30 bg-emerald-50 dark:bg-emerald-400/10 p-5 text-left ${className}`}
    >
      <p className="text-lg font-extrabold text-emerald-950 dark:text-emerald-50">{title}</p>
      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Det koster ingenting å logge inn.</p>
      <ul className="mt-3 space-y-1.5 text-emerald-950 dark:text-emerald-50">
        {LOGIN_BENEFITS.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Check className="mt-0.5 w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-300" strokeWidth={3} aria-hidden="true" />
            <span className="leading-snug">{line}</span>
          </li>
        ))}
      </ul>
      {!canLogIn ? (
        <p className="mt-4 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
          Innlogging er ikke tilgjengelig akkurat nå. Prøv igjen om litt.
        </p>
      ) : onLogin ? (
        <button type="button" onClick={onLogin} disabled={busy} className={button}>
          {busy && <Loader2 className="w-5 h-5 animate-spin" />}
          Logg inn med Vipps
        </button>
      ) : (
        <a href="/api/vipps/start" onClick={() => logEvent('Vipps-innlogging klikket')} className={button}>
          Logg inn med Vipps
        </a>
      )}
    </div>
  );
};

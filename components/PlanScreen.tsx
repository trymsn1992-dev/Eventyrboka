import React, { useState } from 'react';
import { FREE_STORIES_PER_WEEK, Plan } from '../types';
import { Button } from './Button';
import { logEvent } from '../services/analytics';
import { ArrowLeft, Check, CheckCircle, Crown, Loader2, Sparkles } from 'lucide-react';

interface PlanScreenProps {
  // The plan the user is on; null the first time, right after login.
  currentPlan: Plan | null;
  onChooseFree: () => Promise<boolean>;
  onRedeem: (code: string) => Promise<'ok' | 'wrong' | 'error'>;
  // Leave the page (only offered once a plan has been chosen).
  onBack: () => void;
}

const FREE_FEATURES = [
  `${FREE_STORIES_PER_WEEK} nye eventyr hver uke`,
  'Alle seks heltene',
  'Seks lærepenger å velge mellom',
  'Barnet velger veien på hver side',
  'Opplesning og lagring av eventyr',
  'Tegninger i akvarell',
];

const PRO_FEATURES = [
  'Ubegrenset med eventyr',
  'Velg stil på tegningene: akvarell, fargestifter, papirklipp eller tegnefilm',
  'Skriv deres egne lærepenger',
  'Alt som er med i Gratis',
];

const Feature: React.FC<{ children: React.ReactNode; pro?: boolean }> = ({ children, pro }) => (
  <li className="flex items-start gap-3">
    <span
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
        pro ? 'bg-amber-400 text-amber-950' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-200'
      }`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
    <span className="text-sm sm:text-base leading-snug">{children}</span>
  </li>
);

// The choice between Gratis and Pro. Shown right after the first login, and
// later from Min side. Pro can't be bought yet: it is unlocked with a code,
// and the "tell me" button measures how many would want it.
export const PlanScreen: React.FC<PlanScreenProps> = ({ currentPlan, onChooseFree, onRedeem, onBack }) => {
  const [busy, setBusy] = useState<'free' | 'code' | null>(null);
  const [code, setCode] = useState('');
  const [codeMessage, setCodeMessage] = useState('');
  const [freeFailed, setFreeFailed] = useState(false);
  const [interested, setInterested] = useState(false);
  const isPro = currentPlan === 'pro';

  const chooseFree = async () => {
    if (currentPlan) {
      onBack();
      return;
    }
    setBusy('free');
    setFreeFailed(false);
    const ok = await onChooseFree();
    setBusy(null);
    if (!ok) setFreeFailed(true);
  };

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy('code');
    setCodeMessage('');
    const result = await onRedeem(code);
    setBusy(null);
    if (result === 'wrong') setCodeMessage('Koden stemmer ikke. Sjekk at den er skrevet riktig.');
    if (result === 'error') setCodeMessage('Noe gikk galt. Prøv igjen om litt.');
  };

  return (
    <div className="w-full flex flex-col items-center pt-3 pb-8 sm:pt-6 sm:pb-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-6 sm:space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">
            {currentPlan ? 'Gratis eller Pro' : 'Velkommen til Magiboka!'}
          </h2>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300">
            {currentPlan
              ? `Du bruker ${isPro ? 'Pro' : 'Gratis'} nå.`
              : 'Velg hvordan du vil bruke Magiboka. Du kan bytte senere.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 items-stretch">
          {/* Gratis */}
          <section className="flex flex-col bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 p-6 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-indigo-100 dark:border-indigo-900">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-200">
                <Sparkles className="w-6 h-6" />
              </span>
              <h3 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">Gratis</h3>
              {currentPlan === 'gratis' && (
                <span className="ml-auto text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-900/50 px-2 py-1 rounded">
                  Din plan
                </span>
              )}
            </div>
            <p className="text-3xl font-extrabold text-gray-900 dark:text-gray-100 mt-3">0 kr</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Alt du trenger for å komme i gang.</p>
            <ul className="space-y-3 mb-8 flex-grow">
              {FREE_FEATURES.map((f) => (
                <Feature key={f}>{f}</Feature>
              ))}
            </ul>
            {!isPro && (
              <Button onClick={chooseFree} disabled={busy !== null} fullWidth variant={currentPlan ? 'outline' : 'primary'} className="text-lg py-4 flex items-center justify-center gap-2 dark:text-indigo-200 dark:border-indigo-400 dark:hover:bg-indigo-900/40">
                {busy === 'free' && <Loader2 className="w-5 h-5 animate-spin" />}
                {currentPlan ? 'Fortsett med Gratis' : 'Start med Gratis'}
              </Button>
            )}
            {freeFailed && (
              <p role="alert" className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400">
                Kunne ikke lagre valget. Prøv igjen om litt.
              </p>
            )}
          </section>

          {/* Pro */}
          <section className="relative flex flex-col bg-gradient-to-br from-indigo-600 to-purple-700 text-white p-6 sm:p-8 rounded-2xl sm:rounded-3xl shadow-2xl border-2 sm:border-4 border-amber-300">
            <span className="absolute -top-3 right-6 text-xs font-bold uppercase tracking-wider bg-amber-400 text-amber-950 px-3 py-1 rounded-full shadow">
              {isPro ? 'Din plan' : 'Kommer snart'}
            </span>
            <div className="flex items-center gap-3 mb-1">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-400 text-amber-950">
                <Crown className="w-6 h-6" />
              </span>
              <h3 className="text-2xl font-extrabold">Pro</h3>
            </div>
            <p className="text-3xl font-extrabold mt-3">For de som vil ha mer</p>
            <p className="text-sm text-indigo-100 mb-5">Prisen er ikke satt ennå.</p>
            <ul className="space-y-3 mb-8 flex-grow">
              {PRO_FEATURES.map((f) => (
                <Feature key={f} pro>{f}</Feature>
              ))}
            </ul>

            {isPro ? (
              <div className="space-y-3">
                <p className="flex items-center gap-2 font-bold">
                  <CheckCircle className="w-5 h-5 text-amber-300" />
                  Du har Pro. Alt er låst opp.
                </p>
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full rounded-full bg-white text-indigo-700 font-bold text-lg py-4 hover:bg-indigo-50 transition-colors"
                >
                  Lag et eventyr
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {interested ? (
                  <p role="status" className="flex items-center gap-2 font-bold">
                    <CheckCircle className="w-5 h-5 text-amber-300" />
                    Takk! Vi sier fra når Pro er klart.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setInterested(true);
                      logEvent('Pro-interesse', { plan: currentPlan ?? 'ikke valgt' });
                    }}
                    className="w-full rounded-full bg-white text-indigo-700 font-bold text-lg py-4 hover:bg-indigo-50 transition-colors"
                  >
                    Si fra når Pro kommer
                  </button>
                )}

                <form onSubmit={redeem} className="pt-4 border-t border-white/25">
                  <label htmlFor="pro-kode" className="block text-sm font-semibold mb-2">
                    Har du en kode?
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="pro-kode"
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      maxLength={64}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="Skriv koden her"
                      className="min-w-0 flex-1 rounded-xl border-2 border-white/40 bg-white/15 px-4 py-3 font-semibold uppercase tracking-wider text-white placeholder:normal-case placeholder:tracking-normal placeholder:font-normal placeholder:text-indigo-200 focus:outline-none focus:border-amber-300"
                    />
                    <button
                      type="submit"
                      disabled={busy !== null || !code.trim()}
                      className="shrink-0 rounded-xl bg-amber-400 text-amber-950 font-bold px-5 py-3 hover:bg-amber-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {busy === 'code' && <Loader2 className="w-4 h-4 animate-spin" />}
                      Bruk kode
                    </button>
                  </div>
                  {codeMessage && (
                    <p role="alert" className="mt-2 text-sm font-semibold text-amber-200">
                      {codeMessage}
                    </p>
                  )}
                </form>
              </div>
            )}
          </section>
        </div>

        {currentPlan && (
          <div className="text-center">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline"
            >
              <ArrowLeft className="w-4 h-4" />
              Tilbake
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

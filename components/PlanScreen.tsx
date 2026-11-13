import React, { useState } from 'react';
import {
  FREE_STORIES_PER_WEEK,
  PERSONAL_STORY_NAME,
  PLAN_NAMES,
  PRICE_PERSONAL_STORY_KR,
  PRICE_PRINSEN_PER_WEEK_KR,
  PRICE_SIMPLE_STORY_KR,
  STORY_NAME,
  Plan,
} from '../types';
import { logEvent } from '../services/analytics';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';

interface PlanScreenProps {
  // The plan the user is on; null the first time, right after login.
  currentPlan: Plan | null;
  onChooseFree: () => Promise<boolean>;
  // Leave the page (only offered once a plan has been chosen).
  onBack: () => void;
}

const FREE_FEATURES = [
  `Gratis hver uke: ${FREE_STORIES_PER_WEEK} ${STORY_NAME} eller 1 ${PERSONAL_STORY_NAME}`,
  `${STORY_NAME}: ${PRICE_SIMPLE_STORY_KR} kr – når ukas gratis er brukt`,
  `${PERSONAL_STORY_NAME}: ${PRICE_PERSONAL_STORY_KR} kr – egen lærepenge, valgfri tegnestil og opplesning`,
  'Alle seks heltene, og barnet velger veien på hver side',
  'Lagring av historiene på Min side',
];

const PRO_FEATURES = [
  'Så mange historier dere vil',
  `Alt er ${PERSONAL_STORY_NAME}: egen lærepenge, valgfri tegnestil og opplesning`,
  'Ingen binding – si opp når du vil',
  `Alt ${PLAN_NAMES.gratis} får`,
];

const CARD =
  'flex flex-col bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 p-6 sm:p-8 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm';

const PRIMARY_BUTTON =
  'w-full rounded-xl bg-indigo-600 text-white font-semibold text-base py-3 px-4 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2';

const Features: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-3 mb-8 flex-grow">
    {items.map((item) => (
      <li key={item} className="flex items-start gap-3">
        <Check className="mt-1 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-300" strokeWidth={2.5} />
        <span className="text-sm sm:text-base leading-snug">{item}</span>
      </li>
    ))}
  </ul>
);

const CurrentLabel = () => (
  <span className="ml-auto text-xs font-semibold text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded-full px-2.5 py-0.5">
    Din plan
  </span>
);

// The choice between Askeladden (pay per story, free ones each week) and
// Prinsen (weekly price, everything included). Shown right after the first
// login, and later from Min side. Two equal, plainly presented options —
// no badges, no pressure. Nothing can be bought yet: Prinsen is given
// through a share link (see api/_lib/access.ts), and "tell me" counts how
// many would want it.
export const PlanScreen: React.FC<PlanScreenProps> = ({ currentPlan, onChooseFree, onBack }) => {
  const [busy, setBusy] = useState<'free' | null>(null);
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

  return (
    <div className="w-full flex flex-col items-center pt-3 pb-8 sm:pt-6 sm:pb-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-6 sm:space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            {currentPlan ? `${PLAN_NAMES.gratis} eller ${PLAN_NAMES.pro}` : 'Velkommen til Magiboka!'}
          </h2>
          <p className="text-base text-gray-600 dark:text-gray-300">
            {currentPlan
              ? `Du er ${isPro ? PLAN_NAMES.pro : PLAN_NAMES.gratis} nå.`
              : 'Velg det som passer dere. Du kan bytte når som helst.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 items-stretch">
          {/* Askeladden */}
          <section className={CARD}>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{PLAN_NAMES.gratis}</h3>
              {currentPlan === 'gratis' && <CurrentLabel />}
            </div>
            <p className="mt-2 mb-6 text-2xl font-semibold text-gray-900 dark:text-gray-100">Fra 0 kr</p>
            <Features items={FREE_FEATURES} />
            {!isPro && (
              <button type="button" onClick={chooseFree} disabled={busy !== null} className={PRIMARY_BUTTON}>
                {busy === 'free' && <Loader2 className="w-4 h-4 animate-spin" />}
                {currentPlan ? `Fortsett som ${PLAN_NAMES.gratis}` : `Velg ${PLAN_NAMES.gratis}`}
              </button>
            )}
            {freeFailed && (
              <p role="alert" className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400">
                Kunne ikke lagre valget. Prøv igjen om litt.
              </p>
            )}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Kjøp av enkelthistorier kommer snart. Til da gjelder de gratis historiene hver uke.
            </p>
          </section>

          {/* Prinsen */}
          <section className={CARD}>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{PLAN_NAMES.pro}</h3>
              {isPro && <CurrentLabel />}
            </div>
            <p className="mt-2 mb-6 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {PRICE_PRINSEN_PER_WEEK_KR} kr <span className="text-base font-normal text-gray-500 dark:text-gray-400">per uke</span>
            </p>
            <Features items={PRO_FEATURES} />

            {isPro ? (
              <button type="button" onClick={onBack} className={PRIMARY_BUTTON}>
                Lag en historie
              </button>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {PLAN_NAMES.pro} kan ikke kjøpes ennå.{' '}
                {interested ? (
                  <span role="status" className="font-semibold text-gray-900 dark:text-gray-100">
                    Takk, vi sier fra når det er mulig.
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setInterested(true);
                      logEvent('Prinsen-interesse', { plan: currentPlan ?? 'ikke valgt' });
                    }}
                    className="font-semibold text-indigo-600 dark:text-indigo-300 underline underline-offset-4 hover:text-indigo-800 dark:hover:text-indigo-100"
                  >
                    Si fra når det er mulig
                  </button>
                )}
              </p>
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

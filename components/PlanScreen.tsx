import React, { useState } from 'react';
import {
  PLAN_NAMES,
  PRICE_PRINSEN_PER_WEEK_KR,
  Plan,
  WISHES_PER_WEEK,
  WISH_PRICE_KR,
  wishCount,
} from '../types';
import { logEvent } from '../services/analytics';
import { ArrowLeft, Check, Loader2, Star } from 'lucide-react';
import { WISH_USES, niceDate } from './Wishes';

interface PlanScreenProps {
  // The plan the user is on; null the first time, right after login.
  currentPlan: Plan | null;
  onChooseFree: () => Promise<boolean>;
  // Leave the page (only offered once a plan has been chosen).
  onBack: () => void;
  // Extra wishes / Prinsen can be paid for with Vipps.
  canBuy: boolean;
  canSubscribe: boolean;
  // The Prinsen subscription paid with Vipps, if there is one.
  subscription: { status: 'aktiv' | 'stoppet'; paidUntil: string } | null;
  // Prinsen as a gift (share link) lasts through this day.
  giftUntil: string | null;
  // Both resolve to an error message, or null when it went well.
  onSubscribe: () => Promise<string | null>;
  onCancel: () => Promise<string | null>;
}

// What each plan gives: label on the left; on the right a price, or the
// week's wishes drawn as stars.
type PriceRow = { label: string; price?: string; stars?: number };

const FREE_PRICES: PriceRow[] = [
  { label: `${wishCount(WISHES_PER_WEEK.gratis)} hver uke`, stars: WISHES_PER_WEEK.gratis },
  { label: 'Ekstra ønske', price: `${WISH_PRICE_KR.gratis} kr` },
];

const PRO_PRICES: PriceRow[] = [
  { label: `${wishCount(WISHES_PER_WEEK.pro)} hver uke`, stars: WISHES_PER_WEEK.pro },
  { label: 'Ekstra ønske', price: `${WISH_PRICE_KR.pro} kr` },
  { label: 'Binding', price: 'Ingen' },
];

// What is in every story, whatever the plan.
const ALWAYS_INCLUDED = [
  'Alle seks heltene',
  'Barnet velger veien på hver side',
  'Velg tegnestil',
  'Lagres på Min side',
  'Helter og lærepenger dere har laget før',
];

const CARD =
  'flex flex-col bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 p-5 sm:p-8 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm';

const PRIMARY_BUTTON =
  'w-full rounded-xl bg-indigo-600 text-white font-semibold text-base py-3 px-4 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2';

const Prices: React.FC<{ rows: PriceRow[] }> = ({ rows }) => (
  <dl className="mb-8 flex-grow divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
    {rows.map((row) => (
      <div key={row.label} className="flex items-center justify-between gap-4 py-3">
        <dt className="text-base sm:text-lg font-semibold leading-snug text-gray-900 dark:text-gray-100">
          {row.label}
        </dt>
        <dd className="shrink-0 text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
          {row.stars ? (
            <span className="flex gap-0.5" aria-hidden="true">
              {Array.from({ length: row.stars }, (_, i) => (
                <Star key={i} className="w-4 h-4 sm:w-5 sm:h-5 fill-amber-400 text-amber-500" />
              ))}
            </span>
          ) : (
            row.price
          )}
        </dd>
      </div>
    ))}
  </dl>
);

// What a wish is used on, and what comes with every story.
const WishContents = () => (
  <section className={CARD}>
    <h3 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
      <Star className="w-5 h-5 fill-amber-400 text-amber-500" aria-hidden />
      Hva er et ønske?
    </h3>
    <p className="mt-2 text-sm sm:text-base text-gray-600 dark:text-gray-300">
      Alt som koster noe, koster ett ønske. Ukas ønsker fornyes hver mandag, og ønsker du kjøper, varer til de er brukt.
    </p>
    <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Ett ønske gir</h4>
        <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
          {WISH_USES.map((use) => (
            <li key={use.label} className="flex items-center gap-3 py-3">
              <span className="shrink-0 text-indigo-500 dark:text-indigo-300">{use.icon}</span>
              <span className="leading-snug">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{use.label}</span>
                {use.note && <span className="block text-sm text-gray-500 dark:text-gray-400">{use.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Alltid med</h4>
        <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
          {ALWAYS_INCLUDED.map((line) => (
            <li key={line} className="flex items-center gap-3 py-3">
              <Check className="h-5 w-5 shrink-0 text-emerald-500 dark:text-emerald-400" strokeWidth={2.5} aria-hidden />
              <span className="leading-snug">{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

const CurrentLabel = () => (
  <span className="ml-auto text-xs font-semibold text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded-full px-2.5 py-0.5">
    Din plan
  </span>
);

// The choice between Askeladden (free wishes each week, pay for extra ones)
// and Prinsen (weekly price, more wishes, cheaper extra ones). Shown right after the first
// login, and later from Min side. Two equal, plainly presented options —
// no badges, no pressure. Prinsen is paid weekly with Vipps once that is
// switched on (see api/_lib/betaling.ts); until then it is given through a
// share link, and "tell me" counts how many would want it.
export const PlanScreen: React.FC<PlanScreenProps> = ({
  currentPlan,
  onChooseFree,
  onBack,
  canBuy,
  canSubscribe,
  subscription,
  giftUntil,
  onSubscribe,
  onCancel,
}) => {
  const [busy, setBusy] = useState<'free' | 'subscribe' | 'cancel' | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const pay = async (what: 'subscribe' | 'cancel') => {
    setBusy(what);
    setPayError(null);
    const failed = await (what === 'subscribe' ? onSubscribe() : onCancel());
    // On the way to Vipps the button stays busy until the page is left.
    if (failed || what === 'cancel') setBusy(null);
    setPayError(failed);
    setConfirmCancel(false);
  };
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
    // On phones the page is one white sheet from edge to edge (the negative
    // margins cancel the padding on <main>), like the setup card.
    <div className="min-h-screen sm:min-h-0 -mx-4 -mt-4 -mb-4 w-[calc(100%+2rem)] sm:mx-0 sm:mt-0 sm:mb-0 sm:w-full bg-white dark:bg-gray-800 sm:bg-transparent sm:dark:bg-transparent flex flex-col items-center pt-5 pb-8 sm:pt-6 sm:pb-12 px-4 sm:px-6 lg:px-8">
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
            <Prices rows={FREE_PRICES} />
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
            <Prices rows={PRO_PRICES} />

            {isPro ? (
              <>
                <button type="button" onClick={onBack} className={PRIMARY_BUTTON}>
                  Lag en historie
                </button>
                {giftUntil && !subscription && (
                  <p role="status" className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    Du har {PLAN_NAMES.pro} i gave til og med {niceDate(giftUntil)}. Etterpå er du {PLAN_NAMES.gratis},
                    og kan abonnere her om du vil fortsette.
                  </p>
                )}
                {subscription?.status === 'aktiv' && (
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    Neste trekk: {PRICE_PRINSEN_PER_WEEK_KR} kr med Vipps {niceDate(subscription.paidUntil)}.{' '}
                    {confirmCancel ? (
                      <>
                        Sikker?{' '}
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => pay('cancel')}
                          className="font-semibold text-red-600 dark:text-red-400 underline underline-offset-4"
                        >
                          {busy === 'cancel' ? 'Sier opp …' : 'Ja, si opp'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCancel(true)}
                        className="font-semibold text-indigo-600 dark:text-indigo-300 underline underline-offset-4"
                      >
                        Si opp
                      </button>
                    )}
                  </p>
                )}
                {subscription?.status === 'stoppet' && (
                  <p role="status" className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    Abonnementet er sagt opp. Du er {PLAN_NAMES.pro} til {niceDate(subscription.paidUntil)}, og
                    blir ikke trukket mer.
                  </p>
                )}
              </>
            ) : canSubscribe ? (
              <>
                <button
                  type="button"
                  onClick={() => pay('subscribe')}
                  disabled={busy !== null}
                  className={PRIMARY_BUTTON}
                >
                  {busy === 'subscribe' && <Loader2 className="w-4 h-4 animate-spin" />}
                  Bli {PLAN_NAMES.pro} med Vipps
                </button>
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  {PRICE_PRINSEN_PER_WEEK_KR} kr trekkes nå og deretter hver uke, til du sier opp her eller i
                  Vipps-appen.
                </p>
              </>
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
            {payError && (
              <p role="alert" className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400">
                {payError}
              </p>
            )}
          </section>
        </div>

        <WishContents />

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

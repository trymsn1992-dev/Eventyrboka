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
  storyCount,
} from '../types';
import { logEvent } from '../services/analytics';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';

interface PlanScreenProps {
  // The plan the user is on; null the first time, right after login.
  currentPlan: Plan | null;
  onChooseFree: () => Promise<boolean>;
  // Leave the page (only offered once a plan has been chosen).
  onBack: () => void;
  // Single stories / Prinsen can be paid for with Vipps.
  canBuy: boolean;
  canSubscribe: boolean;
  // The Prinsen subscription paid with Vipps, if there is one.
  subscription: { status: 'aktiv' | 'stoppet'; paidUntil: string } | null;
  // Both resolve to an error message, or null when it went well.
  onSubscribe: () => Promise<string | null>;
  onCancel: () => Promise<string | null>;
}

// "2026-11-20" -> "20. november"
const niceDate = (date: string): string => {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' }).format(d);
};

// What each plan costs: label on the left, price on the right.
type PriceRow = { label: string; note?: string; price: string };

const FREE_PRICES: PriceRow[] = [
  {
    label: 'Hver uke',
    note: `${storyCount(FREE_STORIES_PER_WEEK)} eller ${storyCount(1, true)}`,
    price: 'Gratis',
  },
  { label: STORY_NAME, note: 'når ukas gratis er brukt', price: `${PRICE_SIMPLE_STORY_KR} kr` },
  { label: PERSONAL_STORY_NAME, note: 'når ukas gratis er brukt', price: `${PRICE_PERSONAL_STORY_KR} kr` },
];

const PRO_PRICES: PriceRow[] = [
  { label: 'Magihistorier', note: 'så mange dere vil', price: 'Inkludert' },
  { label: 'Binding', note: 'si opp når du vil', price: 'Ingen' },
];

// What is in each kind of story. true = included, false = not included,
// text = included in this form.
type Included = boolean | string;
const STORY_CONTENTS: { label: string; plain: Included; personal: Included }[] = [
  { label: 'Alle seks heltene', plain: true, personal: true },
  { label: 'Lag ny helt fra et bilde av kosedyret', plain: false, personal: true },
  { label: 'Skriv ny lærepenge', plain: false, personal: true },
  { label: 'Helter og lærepenger dere har laget før', plain: true, personal: true },
  { label: 'Barnet velger veien på hver side', plain: true, personal: true },
  { label: 'Lagres på Min side', plain: true, personal: true },
  { label: 'Velg tegnestil', plain: true, personal: true },
  { label: 'Opplesning', plain: false, personal: true },
];

const CARD =
  'flex flex-col bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 p-6 sm:p-8 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm';

const PRIMARY_BUTTON =
  'w-full rounded-xl bg-indigo-600 text-white font-semibold text-base py-3 px-4 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2';

const Prices: React.FC<{ rows: PriceRow[] }> = ({ rows }) => (
  <dl className="mb-8 flex-grow divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
    {rows.map((row) => (
      <div key={row.label} className="flex items-baseline justify-between gap-4 py-3">
        <dt className="text-sm sm:text-base leading-snug">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{row.label}</span>
          {row.note && <span className="block text-sm text-gray-500 dark:text-gray-400">{row.note}</span>}
        </dt>
        <dd className="shrink-0 text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">{row.price}</dd>
      </div>
    ))}
  </dl>
);

const Cell: React.FC<{ value: Included }> = ({ value }) => (
  <td className="py-3 pl-3 text-center align-middle text-sm leading-snug">
    {value === true ? (
      <>
        <Check className="inline h-5 w-5 text-emerald-500 dark:text-emerald-400" strokeWidth={2.5} aria-hidden />
        <span className="sr-only">Med</span>
      </>
    ) : value === false ? (
      <>
        <X className="inline h-5 w-5 text-gray-400 dark:text-gray-500" strokeWidth={2.5} aria-hidden />
        <span className="sr-only">Ikke med</span>
      </>
    ) : (
      value
    )}
  </td>
);

// The two kinds of story side by side: what is in, and what is not.
const StoryContents = () => (
  <section className={CARD}>
    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Hva er med i historiene?</h3>
    <table className="mt-4 w-full table-fixed border-collapse">
      <thead>
        <tr className="text-sm sm:text-base text-gray-900 dark:text-gray-100">
          <th className="w-[34%] sm:w-1/2" />
          <th scope="col" className="pb-2 pl-2 font-bold align-bottom">{STORY_NAME}</th>
          <th scope="col" className="pb-2 pl-2 font-bold align-bottom">{PERSONAL_STORY_NAME}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
        {STORY_CONTENTS.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="py-3 text-left text-sm sm:text-base font-normal leading-snug">{row.label}</th>
            <Cell value={row.plain} />
            <Cell value={row.personal} />
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

const CurrentLabel = () => (
  <span className="ml-auto text-xs font-semibold text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded-full px-2.5 py-0.5">
    Din plan
  </span>
);

// The choice between Askeladden (pay per story, free ones each week) and
// Prinsen (weekly price, everything included). Shown right after the first
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
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {canBuy
                ? 'Historier utover de gratis betales med Vipps når dere lager dem.'
                : 'Kjøp av enkelthistorier kommer snart. Til da gjelder de gratis historiene hver uke.'}
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
            <Prices rows={PRO_PRICES} />

            {isPro ? (
              <>
                <button type="button" onClick={onBack} className={PRIMARY_BUTTON}>
                  Lag en historie
                </button>
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

        <StoryContents />

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

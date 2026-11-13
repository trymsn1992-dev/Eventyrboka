
import React, { useState, useEffect, useRef } from 'react';
import { SetupPreferences } from '../services/account';
import { StoryOptions, CHARACTERS, CHARACTER_TRAITS, METAPHORS, AGE_GROUPS, DURATIONS, ART_STYLES, DEFAULT_ART_STYLE, CUSTOM_METAPHOR_MAX, PLAN_NAMES, PRICE_PERSONAL_STORY_KR, PRICE_SIMPLE_STORY_KR, cleanCustomMetaphor, normalizeAgeGroup } from '../types';
import { Button } from './Button';
import { logEvent } from '../services/analytics';
import { Sparkles, User, Pencil, Lightbulb, Calendar, Clock, Check } from 'lucide-react';

interface SetupScreenProps {
  onStart: (options: StoryOptions) => void;
  isLoading: boolean;
  // The remembered choices (age, length, drawing style). Age and drawing
  // style are set on Min side; length is picked here.
  preferences: SetupPreferences;
  onPreferenceChange: (patch: SetupPreferences) => void;
  // No age has been saved yet (first visit): ask for it here as well.
  askForAge: boolean;
  onOpenProfile: () => void;
  // Pro unlocks your own moral and the drawing style, and has no weekly limit.
  isPro: boolean;
  // Free stories left this week (null when unknown or on Pro).
  freeLeft: number | null;
  onOpenPlan: () => void;
  // A story can be started without a login; reading past the first pages
  // (GUEST_PAGES) needs one.
  loggedIn: boolean;
  // Vipps login is set up, so a guest can be offered it.
  canLogIn: boolean;
}

// Hero and moral picked before logging in survive the trip to Vipps and back.
const PICKED_KEY = 'magiboka_utkast';
const loadPicked = () => {
  const fallback = { character: CHARACTERS[0], metaphor: METAPHORS[0] };
  try {
    const raw = JSON.parse(sessionStorage.getItem(PICKED_KEY) || 'null');
    if (!raw) return fallback;
    return {
      character: CHARACTERS.includes(raw.character) ? raw.character : fallback.character,
      metaphor: METAPHORS.includes(raw.metaphor) ? raw.metaphor : fallback.metaphor,
    };
  } catch {
    return fallback;
  }
};

// Watercolour art for the pickers, drawn from the same character bibles and
// art style as the book illustrations, so the card shows the hero you get.
export const HERO_ART: Record<string, string> = {
  "Ninja-katten Nils": "/velger/nils.webp",
  "Kongekrabba Kim": "/velger/kim.webp",
  "Rom-hunden Rex": "/velger/rex.webp",
  "Prinsesse Pølse": "/velger/polse.webp",
  "Dragen Dagros": "/velger/dagros.webp",
  "Super-sneglen Sivert": "/velger/sivert.webp",
};

const MORAL_ART: Record<string, string> = {
  "Det lønner seg å dele": "/velger/dele.webp",
  "Fokuser på det du kan påvirke": "/velger/pavirke.webp",
  "Vær snill mot andre": "/velger/snill.webp",
  "Det lønner seg å spare": "/velger/spare.webp",
  "Vær mot andre slik du vil at andre skal være mot deg": "/velger/gylne.webp",
  "Ærlighet varer lengst": "/velger/aerlig.webp",
};

// The picked hero drawn in each style, so the style cards show what the
// book will look like. Watercolour reuses the hero portrait.
const STYLE_SUFFIX: Record<string, string> = {
  "Fargestifter": "f",
  "Papirklipp": "p",
  "Tegnefilm": "t",
};

export const styleArt = (character: string, style: string): string | undefined => {
  const hero = HERO_ART[character];
  if (!hero) return undefined;
  const suffix = STYLE_SUFFIX[style];
  return suffix ? hero.replace('/velger/', '/velger/stil/').replace('.webp', `-${suffix}.webp`) : hero;
};

// Marks something that needs Prinsen (the "pro" plan).
export const ProBadge = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-950 ${className}`}>
    {PLAN_NAMES.pro}
  </span>
);

export const SelectedBadge = () => (
  <span className="absolute top-2 right-2 z-10 flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-indigo-600 text-white shadow-md">
    <Check className="h-4 w-4" strokeWidth={3} />
  </span>
);

export const cardClass = (isSelected: boolean) =>
  isSelected
    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100 shadow-lg ring-2 ring-indigo-200 dark:ring-indigo-700 ring-offset-2 dark:ring-offset-gray-800'
    : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:border-indigo-300 hover:shadow-md';

export const SetupScreen: React.FC<SetupScreenProps> = ({
  onStart,
  isLoading,
  preferences,
  onPreferenceChange,
  askForAge,
  onOpenProfile,
  isPro,
  freeLeft,
  onOpenPlan,
  loggedIn,
  canLogIn,
}) => {
  // Hero and moral are picked fresh for every story; the rest is remembered.
  const [picked, setPicked] = useState(loadPicked);
  useEffect(() => {
    try {
      sessionStorage.setItem(PICKED_KEY, JSON.stringify(picked));
    } catch {
      // Private mode — the picks just won't survive the login.
    }
  }, [picked]);
  const options: StoryOptions = {
    ...picked,
    ageGroup: normalizeAgeGroup(preferences.ageGroup),
    duration: preferences.duration ?? DURATIONS[1],
    // Other drawing styles than the standard one are a Pro feature.
    artStyle: isPro ? preferences.artStyle ?? DEFAULT_ART_STYLE : DEFAULT_ART_STYLE,
  };
  const outOfFreeStories = loggedIn && !isPro && freeLeft === 0;
  // Buying single stories isn't possible yet; count who would have.
  const [wantsToBuy, setWantsToBuy] = useState(false);

  // Warm the serverless functions in the background. Sending OPTIONS gets a
  // 405 back without touching Gemini, but it spins up the Vercel lambda so the
  // real POST later skips the cold start. Fire-and-forget.
  useEffect(() => {
    const warm = (url: string) => {
      try {
        void fetch(url, { method: 'OPTIONS' }).catch(() => undefined);
      } catch {
        // ignore
      }
    };
    warm('/api/opener');
    warm('/api/side');
    warm('/api/image');
    warm('/api/character-sheet');
  }, []);

  // The choices in the order they appear on the page. Picking something
  // glides down to the next one that isn't already fully on screen (and to
  // the start button after the last), so nobody has to scroll to find it.
  const STEPS: Array<keyof StoryOptions> = ['character', 'metaphor', 'duration', 'ageGroup'];
  const formRef = useRef<HTMLFormElement>(null);
  const advanceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);
  const advanceFrom = (key: keyof StoryOptions) => {
    window.clearTimeout(advanceTimer.current);
    // A short pause, so the pick is seen landing before the page moves.
    advanceTimer.current = window.setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const steps = Array.from(form.querySelectorAll('[data-step]')) as HTMLElement[];
      const from = STEPS.indexOf(key);
      if (from < 0) return;
      const next = steps.find(el => {
        if (Number(el.dataset.step) <= from) return false;
        const r = el.getBoundingClientRect();
        return r.top < 0 || r.bottom > window.innerHeight;
      });
      if (!next) return;
      const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
      const isStartButton = Number(next.dataset.step) === STEPS.length;
      next.scrollIntoView({ behavior, block: isStartButton ? 'nearest' : 'start' });
    }, 250);
  };

  const handleChange = (key: keyof StoryOptions, value: string) => {
    advanceFrom(key);
    if (key === 'character' || key === 'metaphor') {
      setPicked(prev => ({ ...prev, [key]: value }));
    } else {
      onPreferenceChange({ [key]: value });
    }
  };

  // A grown-up can type their own moral instead of picking one of ours.
  const [useCustomMoral, setUseCustomMoral] = useState(false);
  const [customMoral, setCustomMoral] = useState('');
  const customMoralRef = useRef<HTMLInputElement>(null);
  const pickCustomMoral = () => {
    if (!isPro) {
      window.clearTimeout(advanceTimer.current);
      if (loggedIn) {
        onOpenPlan();
      } else {
        // Not logged in yet: point at the login link by the start button.
        formRef.current
          ?.querySelector(`[data-step="${STEPS.length}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    setUseCustomMoral(true);
    // Stay here and put the cursor in the field — there is something to type.
    window.clearTimeout(advanceTimer.current);
    window.setTimeout(() => customMoralRef.current?.focus(), 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!useCustomMoral) {
      onStart(options);
      return;
    }
    const metaphor = cleanCustomMetaphor(customMoral);
    if (!metaphor) {
      customMoralRef.current?.focus();
      return;
    }
    onStart({ ...options, metaphor });
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center pt-3 pb-8 sm:pt-4 sm:pb-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-6 sm:space-y-8 bg-white dark:bg-gray-800 p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-2xl border-2 sm:border-4 border-indigo-100 dark:border-indigo-900 mb-8 sm:mb-12">
        <div className="text-center">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">Lag din fortelling!</h2>
        </div>

        <form ref={formRef} className="mt-6 sm:mt-10 space-y-8 sm:space-y-12" onSubmit={handleSubmit}>
          
          {/* 1. Character Selection Grid */}
          <div className="space-y-4 scroll-mt-4" data-step={0}>
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
              <User className="w-6 h-6 text-indigo-500" />
              <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">Hvem er helten?</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              {CHARACTERS.map((char) => {
                const isSelected = options.character === char;
                const art = HERO_ART[char];
                return (
                  <button
                    key={char}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleChange('character', char)}
                    className={`group relative p-2 sm:p-3 rounded-2xl border-2 flex flex-col items-center text-center gap-2 transition-all duration-200 ${cardClass(isSelected)}`}
                  >
                    {isSelected && <SelectedBadge />}
                    <div className="w-full aspect-square rounded-xl bg-white overflow-hidden flex items-center justify-center">
                      {art ? (
                        <img
                          src={art}
                          alt=""
                          width={480}
                          height={480}
                          className={`w-full h-full object-cover transition-transform duration-300 ease-out ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`}
                        />
                      ) : (
                        <User className="w-12 h-12 text-gray-400" />
                      )}
                    </div>
                    <span className="pb-1">
                      <span className="block text-sm sm:text-base font-bold leading-tight">{char}</span>
                      {CHARACTER_TRAITS[char] && (
                        <span className="block mt-1 text-[11px] sm:text-xs font-medium leading-snug opacity-75">
                          {CHARACTER_TRAITS[char].tagline}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Metaphor Selection (Hva skal vi lære?) */}
          <div className="space-y-3 sm:space-y-4 scroll-mt-4" data-step={1}>
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
              <Lightbulb className="w-6 h-6 text-amber-500" />
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Hva skal vi lære?</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              {METAPHORS.map((moral) => {
                const isSelected = !useCustomMoral && options.metaphor === moral;
                const art = MORAL_ART[moral];
                return (
                  <button
                    key={moral}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setUseCustomMoral(false);
                      handleChange('metaphor', moral);
                    }}
                    className={`group relative p-2 pr-10 rounded-2xl border-2 flex items-center gap-3 sm:gap-4 text-left transition-all duration-200 ${cardClass(isSelected)}`}
                  >
                    {isSelected && <SelectedBadge />}
                    <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-white overflow-hidden">
                      {art && (
                        <img
                          src={art}
                          alt=""
                          width={480}
                          height={480}
                          loading="lazy"
                          className={`w-full h-full object-cover transition-transform duration-300 ease-out ${isSelected ? 'scale-125' : 'scale-110 group-hover:scale-125'}`}
                        />
                      )}
                    </div>
                    <span className="text-sm sm:text-base font-bold leading-snug">{moral}</span>
                  </button>
                );
              })}
            </div>
            {/* Your own moral: a card that opens a text field. */}
            <div className={`relative rounded-2xl border-2 transition-all duration-200 ${cardClass(useCustomMoral)}`}>
              {useCustomMoral && <SelectedBadge />}
              <button
                type="button"
                aria-pressed={useCustomMoral}
                onClick={pickCustomMoral}
                className="w-full p-2 pr-10 flex items-center gap-3 sm:gap-4 text-left"
              >
                <span className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                  <Pencil className="w-7 h-7 text-amber-500" />
                </span>
                <span>
                  <span className="flex items-center gap-2 text-sm sm:text-base font-bold leading-snug">
                    Skriv din egen
                    {!isPro && <ProBadge />}
                  </span>
                  <span className="block text-[11px] sm:text-xs font-medium opacity-75">Noe dere øver på akkurat nå</span>
                </span>
              </button>
              {useCustomMoral && (
                <div className="px-3 pb-3">
                  <input
                    ref={customMoralRef}
                    type="text"
                    value={customMoral}
                    onChange={(e) => setCustomMoral(e.target.value)}
                    required
                    minLength={3}
                    maxLength={CUSTOM_METAPHOR_MAX}
                    placeholder="F.eks. Det er lov å gjøre feil"
                    aria-label="Din egen moral"
                    className="w-full rounded-xl border-2 border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-900 px-4 py-3 text-base font-semibold text-gray-900 dark:text-gray-100 placeholder:font-normal placeholder:text-gray-400 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 3. Length — and age, until one has been saved (then it lives on Min side) */}
          <div className={askForAge ? 'grid grid-cols-1 md:grid-cols-2 gap-8' : ''}>
            <SelectionSection
               icon={<Clock className="w-6 h-6 text-blue-500" />}
               step={2}
               title="Hvor lenge skal vi lese?"
               options={DURATIONS}
               value={options.duration}
               onChange={(v) => handleChange('duration', v)}
               wide={!askForAge}
            />
            {askForAge && (
              <SelectionSection
                icon={<Calendar className="w-6 h-6 text-pink-500" />}
                step={3}
                title="Alder"
                options={AGE_GROUPS}
                value={options.ageGroup}
                onChange={(v) => handleChange('ageGroup', v)}
              />
            )}
          </div>

          <div className="pt-6 scroll-mb-6" data-step={4}>
            <Button
              type="submit"
              fullWidth
              disabled={isLoading || outOfFreeStories}
              className="flex justify-center items-center gap-3 text-xl py-6 shadow-xl hover:shadow-2xl transform hover:-translate-y-1 transition-all"
            >
              {isLoading ? (
                "Tryller frem historien og tegner bilder..."
              ) : (
                <>
                  <Sparkles className="h-6 w-6" />
                  Start Eventyret
                </>
              )}
            </Button>

            {/* Guests can start right away; the login comes on page 2. */}
            {!loggedIn && (
              <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                Start uten å logge inn. For å lese hele eventyret logger du inn med Vipps underveis.
                {canLogIn && (
                  <>
                    {' '}
                    <a
                      href="/api/vipps/start"
                      onClick={() => logEvent('Vipps-innlogging klikket')}
                      className="underline decoration-dotted underline-offset-4 text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-100"
                    >
                      Logg inn nå
                    </a>
                  </>
                )}
              </p>
            )}

            {/* Free plan: how many stories are left this week. */}
            {loggedIn && !isPro && freeLeft !== null && (
              <p className="mt-4 text-center text-sm font-semibold text-gray-600 dark:text-gray-300">
                {outOfFreeStories
                  ? `Du har brukt ukas gratis historie. En ny kommer på mandag. Kjøp av flere historier (${PRICE_SIMPLE_STORY_KR} kr enkel, ${PRICE_PERSONAL_STORY_KR} kr personlig) kommer snart.`
                  : 'Ukas gratis historie er klar.'}
                {' '}
                <button
                  type="button"
                  onClick={onOpenPlan}
                  className="underline decoration-dotted underline-offset-4 text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-100"
                >
                  Se {PLAN_NAMES.pro}
                </button>
              </p>
            )}
            {outOfFreeStories && (
              <p className="mt-3 text-center text-sm">
                {wantsToBuy ? (
                  <span role="status" className="font-semibold text-emerald-600 dark:text-emerald-400">
                    Takk! Vi sier fra når du kan kjøpe historier.
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setWantsToBuy(true);
                      logEvent('Kjøp ønsket', { type: 'enkelthistorie' });
                    }}
                    className="rounded-full border-2 border-indigo-300 dark:border-indigo-600 px-4 py-2 font-semibold text-indigo-700 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 transition-colors"
                  >
                    Jeg vil kjøpe en historie til
                  </button>
                )}
              </p>
            )}

            {/* What the story is made for. Changed on Min side, not here. */}
            {loggedIn && (
            <p className="mt-5 text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Lages for {options.ageGroup} · {options.artStyle}
              {' · '}
              <button
                type="button"
                onClick={onOpenProfile}
                className="underline decoration-dotted underline-offset-4 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
              >
                Endre på Min side
              </button>
            </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export const SelectionSection = ({ icon, title, options, value, onChange, iconMap, step, wide }: {
  icon: React.ReactNode,
  title: string,
  options: string[],
  value: string,
  onChange: (val: string) => void,
  iconMap?: Record<string, string>,
  // Position among the setup choices, for gliding on to the next one.
  step?: number,
  // Alone on its row: lay the options out side by side on larger screens.
  wide?: boolean
}) => (
  <div className="space-y-3 sm:space-y-4 scroll-mt-4" data-step={step}>
    <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
      {icon}
      <h3 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">{title}</h3>
    </div>
    <div className={`grid grid-cols-2 ${wide ? 'sm:grid-cols-3' : ''} gap-2 sm:gap-3`}>
      {options.map((opt) => {
        const isSelected = value === opt;
        const itemIcon = iconMap ? iconMap[opt] : null;

        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`
              p-2 sm:p-3 rounded-lg sm:rounded-xl text-left transition-all duration-200
              border-2 flex flex-col items-center justify-center text-center gap-1 sm:gap-2 h-full min-h-[72px] sm:min-h-[100px]
              ${isSelected
                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100 shadow-md scale-105 ring-2 ring-indigo-200 dark:ring-indigo-700 ring-offset-1 dark:ring-offset-gray-800'
                : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-200 hover:border-indigo-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }
            `}
          >
            {itemIcon && <span className="text-2xl sm:text-4xl mb-0 sm:mb-1">{itemIcon}</span>}
            <span className="text-xs sm:text-sm font-semibold">{opt}</span>
          </button>
        );
      })}
    </div>
  </div>
);

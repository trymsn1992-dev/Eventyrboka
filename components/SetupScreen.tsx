
import React, { useState, useEffect, useRef } from 'react';
import { SetupPreferences } from '../services/account';
import { StoryOptions, OwnHero, HERO_NAME_MAX, cleanHeroName, CHARACTERS, CHARACTER_TRAITS, METAPHORS, AGE_GROUPS, DURATIONS, ART_STYLES, DEFAULT_ART_STYLE, CUSTOM_METAPHOR_MAX, FREE_STORIES_PER_WEEK, PERSONAL_STORY_NAME, PLAN_NAMES, storyCount, PRICE_PERSONAL_STORY_KR, PRICE_SIMPLE_STORY_KR, STORY_NAME, cleanCustomMetaphor, normalizeAgeGroup } from '../types';
import { Button } from './Button';
import { logEvent } from '../services/analytics';
import { Sparkles, User, Lightbulb, Calendar, Clock, Check, BookOpen, Camera, Loader2 } from 'lucide-react';
import { forgetOwnHero, loadOwnHero, makeHero, preparePhoto, saveOwnHero } from '../services/hero';

interface SetupScreenProps {
  // `personal`: make it a «Magihistorie» (own moral, chosen drawing style, read-aloud).
  onStart: (options: StoryOptions, personal: boolean) => void;
  isLoading: boolean;
  // The remembered choices (age, length, drawing style). Age and drawing
  // style are set on Min side; length is picked here.
  preferences: SetupPreferences;
  onPreferenceChange: (patch: SetupPreferences) => void;
  // No age has been saved yet (first visit): ask for it here as well.
  askForAge: boolean;
  onOpenProfile: () => void;
  // On Pro every story is a «Magihistorie», and there is no weekly limit.
  isPro: boolean;
  // Free stories left this week (null when unknown or on Pro). A «Din
  // historie» needs all of them.
  freeLeft: number | null;
  onOpenPlan: () => void;
  // A story can be started without a login; reading past the first pages
  // (GUEST_PAGES) needs one.
  loggedIn: boolean;
  // Bought stories not yet made, whether more can be bought with Vipps, and
  // the way to buy the one picked here (the story starts when it is paid).
  credits: { plain: number; personal: number };
  canBuy: boolean;
  onBuy: (options: StoryOptions, personal: boolean) => void;
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

// Marks something that needs Prinsen (the "pro" plan) — or, with another
// label, «Magihistorie».
export const ProBadge = ({ className = '', label = PLAN_NAMES.pro }: { className?: string; label?: string }) => (
  <span className={`inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-950 whitespace-nowrap ${className}`}>
    {label}
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
  credits,
  canBuy,
  onBuy,
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
  // The kind of story. Prinsen always gets «Magihistorie». Askeladden picks:
  // it is free while none of the week's free stories are used, and can
  // otherwise be bought. Guests get the plain kind.
  const [wantsPersonal, setWantsPersonal] = useState(false);
  const [personalNote, setPersonalNote] = useState(false);
  const freePersonal = freeLeft === null || freeLeft >= FREE_STORIES_PER_WEEK;
  const canPickPersonal =
    loggedIn && !isPro && (freePersonal || credits.personal > 0 || canBuy);
  const personal = isPro || (wantsPersonal && canPickPersonal);
  // A hero made from a photo of a toy or a drawing (services/hero.ts). The
  // last one made is kept in this browser and can be picked again.
  const [ownHero, setOwnHero] = useState<OwnHero | null>(loadOwnHero);
  const [useOwnHero, setUseOwnHero] = useState(false);
  // The little form for making one: open, with a name, a photo and a status.
  const [heroFormOpen, setHeroFormOpen] = useState(false);
  const [heroName, setHeroName] = useState('');
  const [heroPhoto, setHeroPhoto] = useState<string | null>(null);
  const [heroBusy, setHeroBusy] = useState(false);
  const [heroError, setHeroError] = useState<string | null>(null);
  const heroNameRef = useRef<HTMLInputElement>(null);
  const heroFileRef = useRef<HTMLInputElement>(null);
  // An own hero belongs to «Magihistorie», like your own moral.
  const ownHeroPicked = useOwnHero && personal && ownHero !== null;
  const options: StoryOptions = {
    ...picked,
    ...(ownHeroPicked && ownHero ? { character: ownHero.name, heroToken: ownHero.token } : {}),
    ageGroup: normalizeAgeGroup(preferences.ageGroup),
    duration: preferences.duration ?? DURATIONS[1],
    // Other drawing styles than the standard one belong to «Magihistorie».
    artStyle: personal ? preferences.artStyle ?? DEFAULT_ART_STYLE : DEFAULT_ART_STYLE,
  };
  // The story picked is neither free this week nor already bought.
  const mustPay =
    loggedIn &&
    !isPro &&
    freeLeft !== null &&
    (personal ? !freePersonal && credits.personal === 0 : freeLeft === 0 && credits.plain === 0);
  const price = personal ? PRICE_PERSONAL_STORY_KR : PRICE_SIMPLE_STORY_KR;
  const outOfFreeStories = mustPay && !canBuy;
  // Count each time the week's free stories turn out to be used up.
  useEffect(() => {
    if (mustPay) logEvent('Kvote truffet', { type: personal ? PERSONAL_STORY_NAME : STORY_NAME });
  }, [mustPay, personal]);
  // While single stories can't be bought yet: count who would have.
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
  const pickPlain = () => {
    setWantsPersonal(false);
    setPersonalNote(false);
    setUseCustomMoral(false);
    setUseOwnHero(false);
    setHeroFormOpen(false);
  };
  // True when the story is (now) a «Magihistorie»; otherwise says why not.
  const pickPersonal = (): boolean => {
    if (personal) return true;
    if (canPickPersonal) {
      setWantsPersonal(true);
      setPersonalNote(false);
      return true;
    }
    setPersonalNote(true);
    logEvent('Lås truffet', { funksjon: PERSONAL_STORY_NAME });
    return false;
  };
  const pickCustomMoral = () => {
    // Your own moral makes it a «Magihistorie».
    if (!pickPersonal()) {
      showStoryKind();
      return;
    }
    setUseCustomMoral(true);
    // Stay here and put the cursor in the field — there is something to type.
    window.clearTimeout(advanceTimer.current);
    window.setTimeout(() => customMoralRef.current?.focus(), 0);
  };

  const showStoryKind = () => {
    window.clearTimeout(advanceTimer.current);
    formRef.current
      ?.querySelector('[data-story-kind]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const pickOwnHero = () => {
    // Your own hero makes it a «Magihistorie».
    if (!pickPersonal()) {
      showStoryKind();
      return;
    }
    if (ownHero) {
      setUseOwnHero(true);
      setHeroFormOpen(false);
      advanceFrom('character');
      return;
    }
    openHeroForm();
  };
  const openHeroForm = () => {
    if (!pickPersonal()) {
      showStoryKind();
      return;
    }
    setHeroFormOpen(true);
    setHeroError(null);
    window.clearTimeout(advanceTimer.current);
    window.setTimeout(() => heroNameRef.current?.focus(), 0);
  };
  const handleHeroPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Let the same file be picked again after an error.
    e.target.value = '';
    if (!file) return;
    setHeroError(null);
    try {
      setHeroPhoto(await preparePhoto(file));
    } catch (err) {
      setHeroPhoto(null);
      setHeroError(err instanceof Error ? err.message : 'Vi klarte ikke å åpne bildet.');
    }
  };
  const handleMakeHero = async () => {
    const name = cleanHeroName(heroName);
    if (!name) {
      setHeroError('Gi helten et navn først.');
      heroNameRef.current?.focus();
      return;
    }
    if (!heroPhoto) {
      setHeroError('Ta eller velg et bilde først.');
      return;
    }
    setHeroBusy(true);
    setHeroError(null);
    try {
      const hero = await makeHero(heroPhoto, name, preferences.artStyle);
      void saveOwnHero(hero);
      setOwnHero(hero);
      setUseOwnHero(true);
      setHeroFormOpen(false);
      setHeroPhoto(null);
      setHeroName('');
      logEvent('Egen helt laget');
      advanceFrom('character');
    } catch (err) {
      setHeroError(err instanceof Error ? err.message : 'Kunne ikke lage helten. Prøv igjen.');
    } finally {
      setHeroBusy(false);
    }
  };
  const handleForgetHero = () => {
    forgetOwnHero();
    setOwnHero(null);
    setUseOwnHero(false);
    setHeroFormOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const start = mustPay ? onBuy : onStart;
    if (!useCustomMoral || !personal) {
      start(options, personal);
      return;
    }
    const metaphor = cleanCustomMetaphor(customMoral);
    if (!metaphor) {
      customMoralRef.current?.focus();
      return;
    }
    start({ ...options, metaphor }, personal);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center pt-3 pb-8 sm:pt-4 sm:pb-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-6 sm:space-y-8 bg-white dark:bg-gray-800 p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-2xl border-2 sm:border-4 border-indigo-100 dark:border-indigo-900 mb-8 sm:mb-12">
        <div className="text-center">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">Lag din fortelling!</h2>
        </div>

        <form ref={formRef} className="mt-6 sm:mt-10 space-y-8 sm:space-y-12" onSubmit={handleSubmit}>

          {/* Which kind of story (Prinsen always gets «Magihistorie») */}
          {!isPro && (
            <div className="space-y-3 sm:space-y-4" data-story-kind>
              <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
                <BookOpen className="w-6 h-6 text-emerald-500" />
                <h3 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Hvilken historie?</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                <button
                  type="button"
                  aria-pressed={!personal}
                  onClick={pickPlain}
                  className={`relative p-4 pr-10 rounded-2xl border-2 text-left transition-all duration-200 ${cardClass(!personal)}`}
                >
                  {!personal && <SelectedBadge />}
                  <span className="block text-base sm:text-lg font-bold">{STORY_NAME}</span>
                  <span className="block mt-1 text-xs sm:text-sm font-medium opacity-75">
                    Velg blant lærepengene våre. Tegnet i akvarell.
                  </span>
                  <span className="block mt-2 text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {FREE_STORIES_PER_WEEK} gratis hver uke{canBuy && ` · ellers ${PRICE_SIMPLE_STORY_KR} kr`}
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={personal}
                  onClick={() => pickPersonal()}
                  className={`relative p-4 pr-10 rounded-2xl border-2 text-left transition-all duration-200 ${cardClass(personal)} ${canPickPersonal ? '' : 'opacity-70'}`}
                >
                  {personal && <SelectedBadge />}
                  <span className="block text-base sm:text-lg font-bold">{PERSONAL_STORY_NAME}</span>
                  <span className="block mt-1 text-xs sm:text-sm font-medium opacity-75">
                    Egen helt fra et bilde, egen lærepenge, valgfri tegnestil og opplesning.
                  </span>
                  <span className="block mt-2 text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    1 gratis hver uke{canBuy && ` · ellers ${PRICE_PERSONAL_STORY_KR} kr`}
                  </span>
                </button>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Hver uke får dere {storyCount(FREE_STORIES_PER_WEEK)} eller {storyCount(1, true)} gratis.
              </p>
              {personalNote && !canPickPersonal && (
                <p role="status" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {loggedIn ? (
                    `En magihistorie bruker begge ukas gratis historier, og dere har allerede brukt av dem. Nye kommer på mandag.`
                  ) : (
                    <>
                      Logg inn for å lage en magihistorie.
                      {canLogIn && (
                        <>
                          {' '}
                          <a
                            href="/api/vipps/start"
                            onClick={() => logEvent('Vipps-innlogging klikket')}
                            className="underline underline-offset-4"
                          >
                            Logg inn med Vipps
                          </a>
                        </>
                      )}
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {/* 1. Character Selection Grid */}
          <div className="space-y-4 scroll-mt-4" data-step={0}>
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
              <User className="w-6 h-6 text-indigo-500" />
              <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">Hvem er helten?</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              {CHARACTERS.map((char) => {
                const isSelected = !ownHeroPicked && picked.character === char;
                const art = HERO_ART[char];
                return (
                  <button
                    key={char}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setUseOwnHero(false);
                      setHeroFormOpen(false);
                      handleChange('character', char);
                    }}
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

            {/* Your own hero, drawn from a photo of a toy or a drawing. */}
            <div className={`relative rounded-2xl border-2 transition-all duration-200 ${cardClass(ownHeroPicked || heroFormOpen)}`}>
              {ownHeroPicked && <SelectedBadge />}
              <button
                type="button"
                aria-pressed={ownHeroPicked}
                onClick={pickOwnHero}
                className="w-full p-2 pr-10 flex items-center gap-3 sm:gap-4 text-left"
              >
                {ownHero ? (
                  <span className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-white overflow-hidden">
                    <img src={ownHero.sheet} alt="" className="w-full h-full object-cover object-top" />
                  </span>
                ) : (
                  <span className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                    <Camera className="w-7 h-7 text-indigo-500" />
                  </span>
                )}
                <span>
                  <span className="flex flex-wrap items-center gap-2 text-sm sm:text-base font-bold leading-snug">
                    {ownHero ? ownHero.name : 'Lag din egen helt'}
                  </span>
                  <span className="block text-[11px] sm:text-xs font-medium opacity-75">
                    {ownHero
                      ? ownHero.tagline || 'Helten dere har laget selv'
                      : 'Ta bilde av kosedyret, en leke eller en tegning'}
                  </span>
                </span>
              </button>
              {ownHero && !heroFormOpen && (
                <div className="px-3 pb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm">
                  <button
                    type="button"
                    onClick={openHeroForm}
                    className="underline decoration-dotted underline-offset-4 hover:text-indigo-600 dark:hover:text-indigo-300"
                  >
                    Lag en ny helt
                  </button>
                  <button
                    type="button"
                    onClick={handleForgetHero}
                    className="underline decoration-dotted underline-offset-4 hover:text-indigo-600 dark:hover:text-indigo-300"
                  >
                    Fjern {ownHero.name}
                  </button>
                </div>
              )}
              {heroFormOpen && (
                <div className="px-3 pb-3 space-y-3">
                  <input
                    ref={heroNameRef}
                    type="text"
                    value={heroName}
                    onChange={(e) => setHeroName(e.target.value)}
                    maxLength={HERO_NAME_MAX}
                    disabled={heroBusy}
                    onKeyDown={(e) => {
                      // Enter draws the hero; it must not start the story.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleMakeHero();
                      }
                    }}
                    placeholder="Hva heter helten? F.eks. Bamse"
                    aria-label="Navnet på helten"
                    className="w-full rounded-xl border-2 border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-900 px-4 py-3 text-base font-semibold text-gray-900 dark:text-gray-100 placeholder:font-normal placeholder:text-gray-400 focus:outline-none focus:border-indigo-500"
                  />
                  <input
                    ref={heroFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleHeroPhoto}
                    className="hidden"
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  <div className="flex items-center gap-3">
                    {heroPhoto && (
                      <img
                        src={heroPhoto}
                        alt="Bildet dere har valgt"
                        className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border-2 border-indigo-200 dark:border-indigo-700"
                      />
                    )}
                    <button
                      type="button"
                      disabled={heroBusy}
                      onClick={() => heroFileRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-full border-2 border-indigo-300 dark:border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 transition-colors disabled:opacity-50"
                    >
                      <Camera className="w-4 h-4" />
                      {heroPhoto ? 'Bytt bilde' : 'Ta eller velg bilde'}
                    </button>
                  </div>
                  <button
                    type="button"
                    // Greyed out until there is a photo to draw from.
                    disabled={heroBusy || !heroPhoto}
                    onClick={handleMakeHero}
                    className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold transition-colors ${
                      heroPhoto
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-70'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {heroBusy ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Tegner helten … det tar omtrent et halvt minutt
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        Tegn helten
                      </>
                    )}
                  </button>
                  {heroError && (
                    <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                      {heroError}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Bildet brukes bare til å tegne helten, og lagres ikke. Ta bilde av leker og tegninger, ikke av mennesker.
                  </p>
                </div>
              )}
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
                <img
                  src="/magiboka-ikon.png?v=2"
                  alt=""
                  width={192}
                  height={192}
                  className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm sm:text-base font-bold leading-snug">
                    Skriv din egen
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
              disabled={isLoading || outOfFreeStories || heroBusy}
              className="flex justify-center items-center gap-3 text-xl py-6 shadow-xl hover:shadow-2xl transform hover:-translate-y-1 transition-all"
            >
              {isLoading ? (
                mustPay ? "Åpner Vipps..." : "Tryller frem historien og tegner bilder..."
              ) : mustPay && canBuy ? (
                <>
                  <Sparkles className="h-6 w-6" />
                  Kjøp og start – {price} kr med Vipps
                </>
              ) : (
                <>
                  <Sparkles className="h-6 w-6" />
                  Start Eventyret
                </>
              )}
            </Button>
            {mustPay && canBuy && (
              <p className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
                Du betaler {price} kr i Vipps, og historien lages med en gang du er tilbake.
              </p>
            )}

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
                {credits.plain + credits.personal > 0
                  ? `Dere har til gode: ${[
                      credits.plain > 0 && storyCount(credits.plain),
                      credits.personal > 0 && storyCount(credits.personal, true),
                    ]
                      .filter(Boolean)
                      .join(' og ')}.`
                  : outOfFreeStories
                  ? `Dere har brukt ukas gratis historier. Nye kommer på mandag. Kjøp av flere (vanlig historie ${PRICE_SIMPLE_STORY_KR} kr, magihistorie ${PRICE_PERSONAL_STORY_KR} kr) kommer snart.`
                  : freeLeft === 0
                  ? 'Dere har brukt ukas gratis historier. Nye kommer på mandag.'
                  : freeLeft >= FREE_STORIES_PER_WEEK
                    ? `Ukas gratis historier er klare: ${storyCount(FREE_STORIES_PER_WEEK)} eller ${storyCount(1, true)}.`
                    : `Dere har ${storyCount(freeLeft)} igjen gratis denne uka.`}
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

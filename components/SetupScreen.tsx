
import React, { useState, useEffect, useRef } from 'react';
import { SetupPreferences, loadLocalPreferences } from '../services/account';
import { StoryOptions, CHARACTERS, CHARACTER_TRAITS, METAPHORS, AGE_GROUPS, DURATIONS, ART_STYLES, DEFAULT_ART_STYLE, CUSTOM_METAPHOR_MAX, cleanCustomMetaphor, SavedStory, normalizeAgeGroup } from '../types';
import { Button } from './Button';
import { Sparkles, User, Pencil, Lightbulb, Calendar, Library, Trash2, PlayCircle, Clock, Check, Palette } from 'lucide-react';

interface SetupScreenProps {
  onStart: (options: StoryOptions) => void;
  isLoading: boolean;
  savedStories?: SavedStory[];
  // Age, length and drawing style saved on the account, once the server has answered.
  savedPreferences?: SetupPreferences;
  onLoadStory?: (story: SavedStory) => void;
  onDeleteStory?: (e: React.MouseEvent, id: string) => void;
}

// Watercolour art for the pickers, drawn from the same character bibles and
// art style as the book illustrations, so the card shows the hero you get.
const HERO_ART: Record<string, string> = {
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

const styleArt = (character: string, style: string): string | undefined => {
  const hero = HERO_ART[character];
  if (!hero) return undefined;
  const suffix = STYLE_SUFFIX[style];
  return suffix ? hero.replace('/velger/', '/velger/stil/').replace('.webp', `-${suffix}.webp`) : hero;
};

const SelectedBadge = () => (
  <span className="absolute top-2 right-2 z-10 flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-indigo-600 text-white shadow-md">
    <Check className="h-4 w-4" strokeWidth={3} />
  </span>
);

const cardClass = (isSelected: boolean) =>
  isSelected
    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100 shadow-lg ring-2 ring-indigo-200 dark:ring-indigo-700 ring-offset-2 dark:ring-offset-gray-800'
    : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:border-indigo-300 hover:shadow-md';

export const SetupScreen: React.FC<SetupScreenProps> = ({ 
  onStart, 
  isLoading,
  savedStories = [],
  savedPreferences,
  onLoadStory,
  onDeleteStory
}) => {
  // Age, length and drawing style start from what was chosen last time in
  // this browser.
  const [options, setOptions] = useState<StoryOptions>(() => ({
    character: CHARACTERS[0],
    metaphor: METAPHORS[0],
    ageGroup: AGE_GROUPS[1],
    duration: DURATIONS[1],
    artStyle: DEFAULT_ART_STYLE,
    ...loadLocalPreferences(),
  }));

  // The account's saved choices arrive a moment later and win over the
  // browser's — unless the user has already picked something on this visit.
  const touched = useRef(new Set<keyof StoryOptions>());
  const savedAge = savedPreferences?.ageGroup;
  const savedDuration = savedPreferences?.duration;
  const savedStyle = savedPreferences?.artStyle;
  useEffect(() => {
    setOptions(prev => ({
      ...prev,
      ...(savedAge && !touched.current.has('ageGroup') ? { ageGroup: savedAge } : {}),
      ...(savedDuration && !touched.current.has('duration') ? { duration: savedDuration } : {}),
      ...(savedStyle && !touched.current.has('artStyle') ? { artStyle: savedStyle } : {}),
    }));
  }, [savedAge, savedDuration, savedStyle]);

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
  const STEPS: Array<keyof StoryOptions> = ['character', 'metaphor', 'artStyle', 'duration', 'ageGroup'];
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
    touched.current.add(key);
    advanceFrom(key);
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  // A grown-up can type their own moral instead of picking one of ours.
  const [useCustomMoral, setUseCustomMoral] = useState(false);
  const [customMoral, setCustomMoral] = useState('');
  const customMoralRef = useRef<HTMLInputElement>(null);
  const pickCustomMoral = () => {
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
                  <span className="block text-sm sm:text-base font-bold leading-snug">Skriv din egen</span>
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

          {/* 3. Drawing style — previewed with the picked hero */}
          <div className="space-y-3 sm:space-y-4 scroll-mt-4" data-step={2}>
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
              <Palette className="w-6 h-6 text-emerald-500" />
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Hvordan skal tegningene se ut?</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {ART_STYLES.map((style) => {
                const isSelected = (options.artStyle ?? DEFAULT_ART_STYLE) === style;
                const art = styleArt(options.character, style);
                return (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleChange('artStyle', style)}
                    className={`group relative p-2 rounded-2xl border-2 flex flex-col items-center text-center gap-1.5 transition-all duration-200 ${cardClass(isSelected)}`}
                  >
                    {isSelected && <SelectedBadge />}
                    <div className="w-full aspect-square rounded-xl bg-white overflow-hidden">
                      {art && (
                        <img
                          src={art}
                          alt=""
                          width={360}
                          height={360}
                          loading="lazy"
                          className={`w-full h-full object-cover transition-transform duration-300 ease-out ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`}
                        />
                      )}
                    </div>
                    <span className="text-sm sm:text-base font-bold leading-tight pb-1">{style}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Duration + Age */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <SelectionSection
               icon={<Clock className="w-6 h-6 text-blue-500" />}
               step={3}
               title="Hvor lenge skal vi lese?"
               options={DURATIONS}
               value={options.duration}
               onChange={(v) => handleChange('duration', v)}
            />
            <SelectionSection
              icon={<Calendar className="w-6 h-6 text-pink-500" />}
              step={4}
              title="Alder"
              options={AGE_GROUPS}
              value={normalizeAgeGroup(options.ageGroup)}
              onChange={(v) => handleChange('ageGroup', v)}
            />
          </div>

          <div className="pt-6 scroll-mb-6" data-step={5}>
            <Button 
              type="submit" 
              fullWidth 
              disabled={isLoading}
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
          </div>
        </form>
      </div>

      {/* Saved Stories Section */}
      {savedStories.length > 0 && (
        <div className="max-w-5xl w-full animate-fade-in-up pb-12">
          <div className="flex items-center gap-3 mb-6">
            <Library className="w-8 h-8 text-indigo-700" />
            <h3 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-serif">Mitt Bibliotek</h3>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {savedStories.map((story) => (
              <div 
                key={story.id}
                onClick={() => onLoadStory && onLoadStory(story)}
                className="group bg-white dark:bg-gray-800 rounded-xl p-5 shadow-md border border-indigo-50 dark:border-indigo-900 hover:shadow-xl hover:border-indigo-200 dark:hover:border-indigo-700 transition-all duration-300 cursor-pointer relative overflow-hidden flex flex-col"
              >
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-400 to-purple-400"></div>
                
                <div className="mb-4 flex-grow">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-2 py-1 rounded">
                      {normalizeAgeGroup(story.options.ageGroup)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(story.createdAt).toLocaleDateString('no-NO')}
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
                    {story.options.character}
                  </h4>
                  <p className="text-sm text-gray-500 line-clamp-2">
                     {story.options.metaphor}
                  </p>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                   <div className="flex items-center text-indigo-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Les på nytt
                   </div>
                   <button 
                      onClick={(e) => onDeleteStory && onDeleteStory(e, story.id)}
                      className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition-colors"
                      title="Slett fra biblioteket"
                   >
                      <Trash2 className="w-4 h-4" />
                   </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SelectionSection = ({ icon, title, options, value, onChange, iconMap, step }: {
  icon: React.ReactNode,
  title: string,
  options: string[],
  value: string,
  onChange: (val: string) => void,
  iconMap?: Record<string, string>,
  // Position among the setup choices, for gliding on to the next one.
  step?: number
}) => (
  <div className="space-y-3 sm:space-y-4 scroll-mt-4" data-step={step}>
    <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
      {icon}
      <h3 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">{title}</h3>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:gap-3">
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

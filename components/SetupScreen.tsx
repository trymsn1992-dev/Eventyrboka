
import React, { useState, useEffect, useRef } from 'react';
import { SetupPreferences, loadLocalPreferences } from '../services/account';
import { StoryOptions, CHARACTERS, METAPHORS, AGE_GROUPS, DURATIONS, SavedStory, normalizeAgeGroup } from '../types';
import { Button } from './Button';
import { BookOpen, Sparkles, User, Lightbulb, Calendar, Library, Trash2, PlayCircle, Clock, Check } from 'lucide-react';

interface SetupScreenProps {
  onStart: (options: StoryOptions) => void;
  isLoading: boolean;
  savedStories?: SavedStory[];
  // Age and length saved on the account, once the server has answered.
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
  // Age and length start from what was chosen last time in this browser.
  const [options, setOptions] = useState<StoryOptions>(() => ({
    character: CHARACTERS[0],
    metaphor: METAPHORS[0],
    ageGroup: AGE_GROUPS[1],
    duration: DURATIONS[1],
    ...loadLocalPreferences(),
  }));

  // The account's saved choices arrive a moment later and win over the
  // browser's — unless the user has already picked something on this visit.
  const touched = useRef(new Set<keyof StoryOptions>());
  const savedAge = savedPreferences?.ageGroup;
  const savedDuration = savedPreferences?.duration;
  useEffect(() => {
    setOptions(prev => ({
      ...prev,
      ...(savedAge && !touched.current.has('ageGroup') ? { ageGroup: savedAge } : {}),
      ...(savedDuration && !touched.current.has('duration') ? { duration: savedDuration } : {}),
    }));
  }, [savedAge, savedDuration]);

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

  const handleChange = (key: keyof StoryOptions, value: string) => {
    touched.current.add(key);
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart(options);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center pt-3 pb-8 sm:pt-4 sm:pb-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-6 sm:space-y-8 bg-white dark:bg-gray-800 p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-2xl border-2 sm:border-4 border-indigo-100 dark:border-indigo-900 mb-8 sm:mb-12">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 sm:h-20 sm:w-20 bg-indigo-100 dark:bg-indigo-900/40 rounded-full flex items-center justify-center mb-3 sm:mb-4">
            <BookOpen className="h-7 w-7 sm:h-10 sm:w-10 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">Lag din fortelling!</h2>
        </div>

        <form className="mt-6 sm:mt-10 space-y-8 sm:space-y-12" onSubmit={handleSubmit}>
          
          {/* 1. Character Selection Grid */}
          <div className="space-y-4">
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
                    <span className="text-sm sm:text-base font-bold leading-tight pb-1">{char}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Metaphor Selection (Hva skal vi lære?) */}
          <div className="space-y-3 sm:space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
              <Lightbulb className="w-6 h-6 text-amber-500" />
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Hva skal vi lære?</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              {METAPHORS.map((moral) => {
                const isSelected = options.metaphor === moral;
                const art = MORAL_ART[moral];
                return (
                  <button
                    key={moral}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleChange('metaphor', moral)}
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
          </div>

          {/* 3. Duration + Age */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <SelectionSection
               icon={<Clock className="w-6 h-6 text-blue-500" />}
               title="Hvor lenge skal vi lese?"
               options={DURATIONS}
               value={options.duration}
               onChange={(v) => handleChange('duration', v)}
            />
            <SelectionSection
              icon={<Calendar className="w-6 h-6 text-pink-500" />}
              title="Alder"
              options={AGE_GROUPS}
              value={normalizeAgeGroup(options.ageGroup)}
              onChange={(v) => handleChange('ageGroup', v)}
            />
          </div>

          <div className="pt-6">
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

const SelectionSection = ({ icon, title, options, value, onChange, iconMap }: {
  icon: React.ReactNode,
  title: string,
  options: string[],
  value: string,
  onChange: (val: string) => void,
  iconMap?: Record<string, string>
}) => (
  <div className="space-y-3 sm:space-y-4">
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

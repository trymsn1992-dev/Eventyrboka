
import React, { useState, useEffect, useRef } from 'react';
import { SetupPreferences, loadLocalPreferences } from '../services/account';
import { StoryOptions, CHARACTERS, METAPHORS, AGE_GROUPS, DURATIONS, SavedStory, normalizeAgeGroup } from '../types';
import { Button } from './Button';
import { BookOpen, Sparkles, User, Lightbulb, Calendar, Library, Trash2, PlayCircle, Clock } from 'lucide-react';

interface SetupScreenProps {
  onStart: (options: StoryOptions) => void;
  isLoading: boolean;
  savedStories?: SavedStory[];
  // Age and length saved on the account, once the server has answered.
  savedPreferences?: SetupPreferences;
  onLoadStory?: (story: SavedStory) => void;
  onDeleteStory?: (e: React.MouseEvent, id: string) => void;
}

const CharacterAvatar = ({ name, selected }: { name: string, selected: boolean }) => {
  // Base SVG logic
  const bgClass = selected ? "scale-110 drop-shadow-xl filter saturate-110" : "grayscale-[0.2] hover:grayscale-0 hover:scale-105";
  const transition = "transition-all duration-300 ease-in-out";

  switch (name) {
    case "Ninja-katten Nils":
      return (
        <svg viewBox="0 0 100 100" className={`w-16 h-16 sm:w-24 sm:h-24 ${bgClass} ${transition}`}>
          <defs>
            <linearGradient id="catFur" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFD54F" />
              <stop offset="100%" stopColor="#FF8F00" />
            </linearGradient>
            <linearGradient id="headband" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#424242" />
              <stop offset="100%" stopColor="#212121" />
            </linearGradient>
          </defs>
          {/* Ears */}
          <path d="M20 30 L15 5 L45 25" fill="url(#catFur)" stroke="#E65100" strokeWidth="1"/>
          <path d="M80 30 L85 5 L55 25" fill="url(#catFur)" stroke="#E65100" strokeWidth="1"/>
          {/* Head */}
          <circle cx="50" cy="50" r="40" fill="url(#catFur)" stroke="#E65100" strokeWidth="1"/>
          {/* Headband */}
          <path d="M12 35 C12 35 30 30 50 30 C70 30 88 35 88 35 L88 50 C88 50 70 45 50 45 C30 45 12 50 12 50 Z" fill="url(#headband)"/>
          <circle cx="50" cy="38" r="6" fill="#D32F2F" stroke="white" strokeWidth="1"/>
          <path d="M10 35 L5 30 M5 40 L0 45" stroke="#333" strokeWidth="3" strokeLinecap="round"/> {/* Headband ties */}
          {/* Face */}
          <ellipse cx="35" cy="60" rx="5" ry="7" fill="#333" />
          <ellipse cx="65" cy="60" rx="5" ry="7" fill="#333" />
          <circle cx="37" cy="58" r="2" fill="white" />
          <circle cx="67" cy="58" r="2" fill="white" />
          <path d="M45 70 L50 75 L55 70" fill="#3E2723" />
          <path d="M30 75 L15 72 M30 80 L15 82 M70 75 L85 72 M70 80 L85 82" stroke="#3E2723" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case "Kongekrabba Kim":
      return (
        <svg viewBox="0 0 100 100" className={`w-16 h-16 sm:w-24 sm:h-24 ${bgClass} ${transition}`}>
          <defs>
            <radialGradient id="crabBody" cx="50%" cy="50%" r="50%" fx="40%" fy="40%">
              <stop offset="0%" stopColor="#FF8A80" />
              <stop offset="100%" stopColor="#C62828" />
            </radialGradient>
            <linearGradient id="crownGold" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFECB3" />
              <stop offset="50%" stopColor="#FFCA28" />
              <stop offset="100%" stopColor="#FF6F00" />
            </linearGradient>
          </defs>
          {/* Legs */}
          <path d="M10 55 Q5 40 20 35" stroke="#C62828" strokeWidth="5" strokeLinecap="round" fill="none"/>
          <path d="M10 65 Q5 65 20 60" stroke="#C62828" strokeWidth="5" strokeLinecap="round" fill="none"/>
          <path d="M90 55 Q95 40 80 35" stroke="#C62828" strokeWidth="5" strokeLinecap="round" fill="none"/>
          <path d="M90 65 Q95 65 80 60" stroke="#C62828" strokeWidth="5" strokeLinecap="round" fill="none"/>
          {/* Claws */}
          <path d="M25 35 L10 15" stroke="#C62828" strokeWidth="8" strokeLinecap="round"/>
          <circle cx="10" cy="15" r="8" fill="#D32F2F"/>
          <path d="M10 15 L5 5 M10 15 L18 8" stroke="#D32F2F" strokeWidth="4" strokeLinecap="round"/>

          <path d="M75 35 L90 15" stroke="#C62828" strokeWidth="8" strokeLinecap="round"/>
          <circle cx="90" cy="15" r="8" fill="#D32F2F"/>
          <path d="M90 15 L95 5 M90 15 L82 8" stroke="#D32F2F" strokeWidth="4" strokeLinecap="round"/>

          {/* Body */}
          <ellipse cx="50" cy="60" rx="35" ry="25" fill="url(#crabBody)" stroke="#B71C1C" strokeWidth="1"/>
          {/* Face */}
          <circle cx="38" cy="50" r="8" fill="white" stroke="#B71C1C" strokeWidth="1"/>
          <circle cx="38" cy="50" r="3" fill="black" />
          <circle cx="62" cy="50" r="8" fill="white" stroke="#B71C1C" strokeWidth="1"/>
          <circle cx="62" cy="50" r="3" fill="black" />
          <path d="M40 68 Q50 75 60 68" stroke="#7f0000" strokeWidth="2" fill="none" strokeLinecap="round"/>
          
          {/* Crown */}
          <path d="M30 35 L30 20 L40 30 L50 10 L60 30 L70 20 L70 35 Z" fill="url(#crownGold)" stroke="#FFA000" strokeWidth="1"/>
          <circle cx="50" cy="10" r="3" fill="red" />
          <circle cx="30" cy="20" r="2" fill="blue" />
          <circle cx="70" cy="20" r="2" fill="green" />
        </svg>
      );
    case "Rom-hunden Rex":
      return (
        <svg viewBox="0 0 100 100" className={`w-16 h-16 sm:w-24 sm:h-24 ${bgClass} ${transition}`}>
          <defs>
            <linearGradient id="helmetGlass" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#E3F2FD" stopOpacity="0.4"/>
              <stop offset="50%" stopColor="#90CAF9" stopOpacity="0.2"/>
              <stop offset="100%" stopColor="#42A5F5" stopOpacity="0.1"/>
            </linearGradient>
            <linearGradient id="dogFur" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFF59D" />
              <stop offset="100%" stopColor="#FBC02D" />
            </linearGradient>
          </defs>
          {/* Ears */}
          <path d="M25 45 L20 20 L45 35" fill="url(#dogFur)" /> 
          <path d="M75 45 L80 20 L55 35" fill="url(#dogFur)" />
          
          {/* Head */}
          <circle cx="50" cy="55" r="28" fill="url(#dogFur)" />
          
          {/* Face */}
          <ellipse cx="42" cy="50" rx="4" ry="6" fill="#3E2723"/>
          <ellipse cx="58" cy="50" rx="4" ry="6" fill="#3E2723"/>
          <circle cx="44" cy="48" r="2" fill="white"/>
          <circle cx="60" cy="48" r="2" fill="white"/>
          <ellipse cx="50" cy="60" rx="6" ry="4" fill="#3E2723"/>
          <path d="M50 64 L50 68" stroke="#3E2723" strokeWidth="2"/>
          
          {/* Suit Collar */}
          <path d="M15 85 Q50 95 85 85 L85 100 L15 100 Z" fill="#ECEFF1" stroke="#90A4AE" strokeWidth="1"/>
          <rect x="35" y="88" width="30" height="8" rx="4" fill="#CFD8DC" />

          {/* Helmet */}
          <circle cx="50" cy="50" r="42" fill="url(#helmetGlass)" stroke="#B0BEC5" strokeWidth="3" />
          {/* Reflection */}
          <path d="M25 35 Q40 20 65 25" stroke="white" strokeWidth="4" strokeLinecap="round" opacity="0.6" fill="none"/>
          
          {/* Antenna */}
          <line x1="50" y1="8" x2="50" y2="0" stroke="#78909C" strokeWidth="3" />
          <circle cx="50" cy="0" r="4" fill="#F44336" />
        </svg>
      );
    case "Prinsesse Pølse":
      return (
        <svg viewBox="0 0 100 100" className={`w-16 h-16 sm:w-24 sm:h-24 ${bgClass} ${transition}`}>
          <defs>
            <linearGradient id="sausageSkin" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#EF9A9A" />
              <stop offset="50%" stopColor="#E57373" />
              <stop offset="100%" stopColor="#EF5350" />
            </linearGradient>
            <linearGradient id="dressPink" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#F48FB1" />
              <stop offset="100%" stopColor="#AD1457" />
            </linearGradient>
          </defs>
          {/* Dress */}
          <path d="M30 60 L20 95 L80 95 L70 60 Z" fill="url(#dressPink)" />
          
          {/* Arms */}
          <path d="M30 45 L15 35" stroke="#E57373" strokeWidth="4" strokeLinecap="round"/>
          <path d="M70 45 L85 35" stroke="#E57373" strokeWidth="4" strokeLinecap="round"/>

          {/* Body (Sausage) */}
          <rect x="30" y="20" width="40" height="65" rx="20" fill="url(#sausageSkin)" />
          
          {/* Face */}
          <circle cx="42" cy="35" r="3" fill="#333" />
          <circle cx="58" cy="35" r="3" fill="#333" />
          <path d="M45 45 Q50 48 55 45" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round"/>
          <circle cx="35" cy="40" r="3" fill="#FFCDD2" opacity="0.6"/>
          <circle cx="65" cy="40" r="3" fill="#FFCDD2" opacity="0.6"/>

          {/* Tiara */}
          <path d="M35 20 L35 10 L42 18 L50 5 L58 18 L65 10 L65 20" fill="#FFD700" stroke="#FFA000" strokeWidth="1"/>
          <circle cx="50" cy="5" r="2" fill="#F06292" />
        </svg>
      );
    case "Dragen Dagros":
      return (
        <svg viewBox="0 0 100 100" className={`w-16 h-16 sm:w-24 sm:h-24 ${bgClass} ${transition}`}>
          <defs>
            <linearGradient id="dragonBody" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#C8E6C9" />
              <stop offset="100%" stopColor="#81C784" />
            </linearGradient>
          </defs>
          {/* Wings */}
          <path d="M25 45 Q10 35 15 20 Q30 30 35 40" fill="#A5D6A7" stroke="#4CAF50" strokeWidth="1"/>
          <path d="M75 45 Q90 35 85 20 Q70 30 65 40" fill="#A5D6A7" stroke="#4CAF50" strokeWidth="1"/>

          {/* Body */}
          <path d="M30 50 Q50 30 70 50 Q80 70 70 85 Q50 95 30 85 Q20 70 30 50" fill="url(#dragonBody)" stroke="#388E3C" strokeWidth="1"/>
          
          {/* Cow Spots */}
          <path d="M40 55 Q45 50 50 55 Q52 60 45 65 Q38 60 40 55" fill="#333" opacity="0.8"/>
          <path d="M60 70 Q65 65 70 70 Q72 75 65 80 Q58 75 60 70" fill="#333" opacity="0.8"/>
          
          {/* Head */}
          <ellipse cx="50" cy="40" rx="20" ry="18" fill="url(#dragonBody)" stroke="#388E3C" strokeWidth="1"/>
          
          {/* Horns */}
          <path d="M35 28 L30 15 L40 25" fill="#E0E0E0" stroke="#9E9E9E" strokeWidth="1"/>
          <path d="M65 28 L70 15 L60 25" fill="#E0E0E0" stroke="#9E9E9E" strokeWidth="1"/>
          
          {/* Face */}
          <circle cx="42" cy="38" r="2" fill="black"/>
          <circle cx="58" cy="38" r="2" fill="black"/>
          <ellipse cx="50" cy="48" rx="6" ry="4" fill="#A5D6A7" stroke="#388E3C" strokeWidth="1"/>
          <circle cx="48" cy="48" r="1" fill="#2E7D32"/>
          <circle cx="52" cy="48" r="1" fill="#2E7D32"/>
          
          {/* Bell */}
          <rect x="45" y="85" width="10" height="8" fill="#FFD54F" stroke="#FBC02D" strokeWidth="1"/>
          <circle cx="50" cy="93" r="2" fill="#FBC02D"/>
          <path d="M45 85 L55 85" stroke="#795548" strokeWidth="2"/>
        </svg>
      );
    case "Super-sneglen Sivert":
      return (
        <svg viewBox="0 0 100 100" className={`w-16 h-16 sm:w-24 sm:h-24 ${bgClass} ${transition}`}>
           <defs>
            <linearGradient id="shell" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D7CCC8" />
              <stop offset="100%" stopColor="#8D6E63" />
            </linearGradient>
          </defs>
           {/* Cape - Behind */}
           <path d="M60 50 Q90 40 95 60 L85 85 Q70 70 60 65" fill="#D32F2F" />
           
           {/* Shell */}
           <circle cx="50" cy="55" r="22" fill="url(#shell)" stroke="#5D4037" strokeWidth="1"/>
           <path d="M50 55 m-14 0 a 14 14 0 1 0 28 0 a 14 14 0 1 0 -28 0" stroke="#5D4037" strokeWidth="1.5" fill="none" />
           <path d="M50 55 m-7 0 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0" stroke="#5D4037" strokeWidth="1.5" fill="none" />

           {/* Body */}
           <path d="M20 80 Q25 90 50 90 L75 90 Q85 90 90 85" stroke="#A1887F" strokeWidth="10" strokeLinecap="round" fill="none"/>
           
           {/* Head Upright */}
           <path d="M25 85 Q20 60 30 55" stroke="#A1887F" strokeWidth="10" strokeLinecap="round" fill="none"/>
           <circle cx="30" cy="55" r="10" fill="#A1887F" />

           {/* Eye Stalks */}
           <line x1="25" y1="48" x2="20" y2="35" stroke="#A1887F" strokeWidth="2" />
           <circle cx="20" cy="35" r="3" fill="#A1887F" />
           <line x1="35" y1="48" x2="40" y2="35" stroke="#A1887F" strokeWidth="2" />
           <circle cx="40" cy="35" r="3" fill="#A1887F" />

           {/* Mask */}
           <path d="M20 52 L40 52 L40 58 L20 58 Z" fill="#1976D2" />
           <circle cx="25" cy="55" r="2" fill="white" />
           <circle cx="35" cy="55" r="2" fill="white" />
           
           {/* Smile */}
           <path d="M28 62 Q30 64 32 62" stroke="#3E2723" strokeWidth="1" fill="none"/>
        </svg>
      );
    default:
      return <User className="w-12 h-12 text-gray-400" />;
  }
};

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
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100">
              <User className="w-6 h-6 text-indigo-500" />
              <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">Hvem er helten?</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {CHARACTERS.map((char) => {
                const isSelected = options.character === char;
                return (
                  <button
                    key={char}
                    type="button"
                    onClick={() => handleChange('character', char)}
                    className={`
                      p-3 sm:p-4 rounded-xl sm:rounded-2xl text-left transition-all duration-200
                      border-2 flex flex-col items-center justify-between text-center gap-2 sm:gap-3 h-full min-h-[120px] sm:min-h-[160px]
                      ${isSelected
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100 shadow-md ring-2 ring-indigo-200 dark:ring-indigo-700 ring-offset-2 dark:ring-offset-gray-800'
                        : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-200 hover:border-indigo-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                      }
                    `}
                  >
                    <div className="flex-grow flex items-center justify-center w-full">
                       <CharacterAvatar name={char} selected={isSelected} />
                    </div>
                    <span className="text-sm font-bold">{char}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Metaphor Selection (Hva skal vi lære?) */}
          <SelectionSection
            icon={<Lightbulb className="w-6 h-6 text-amber-500" />}
            title="Hva skal vi lære?"
            options={METAPHORS}
            value={options.metaphor}
            onChange={(v) => handleChange('metaphor', v)}
          />

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

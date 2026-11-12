import React from 'react';
import { SetupPreferences } from '../services/account';
import { AGE_GROUPS, ART_STYLES, DEFAULT_ART_STYLE, SavedStory, normalizeAgeGroup } from '../types';
import { Button } from './Button';
import { ProBadge, SelectedBadge, SelectionSection, cardClass, styleArt } from './SetupScreen';
import { ArrowLeft, Calendar, CheckCircle, Crown, Library, Palette, PlayCircle, Sparkles, Trash2 } from 'lucide-react';

// Where the last change to the choices ended up.
export type SaveState = 'idle' | 'local' | 'account' | 'account-failed';

interface ProfileScreenProps {
  fornavn: string;
  innlogget: boolean;
  // Vipps login is set up, so it makes sense to offer it.
  canLogIn: boolean;
  preferences: SetupPreferences;
  onPreferenceChange: (patch: SetupPreferences) => void;
  saveState: SaveState;
  savedStories: SavedStory[];
  onLoadStory: (story: SavedStory) => void;
  onDeleteStory: (e: React.MouseEvent, id: string) => void;
  onBack: () => void;
  // Pro unlocks the choice of drawing style.
  isPro: boolean;
  onOpenPlan: () => void;
}

// The style cards need a hero to show the style on.
const PREVIEW_HERO = 'Ninja-katten Nils';

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  local: 'Lagret i denne nettleseren',
  account: 'Lagret på kontoen din',
  'account-failed': 'Lagret i denne nettleseren, men ikke på kontoen',
};

// Min side: the saved stories, and the choices that are remembered between
// visits (age and drawing style). A change is saved the moment it is made.
export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  fornavn,
  innlogget,
  canLogIn,
  preferences,
  onPreferenceChange,
  saveState,
  savedStories,
  onLoadStory,
  onDeleteStory,
  onBack,
  isPro,
  onOpenPlan,
}) => {
  const artStyle = isPro ? preferences.artStyle ?? DEFAULT_ART_STYLE : DEFAULT_ART_STYLE;
  return (
    <div className="min-h-screen w-full flex flex-col items-center pt-3 pb-8 sm:pt-4 sm:pb-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-8 sm:space-y-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">
            {fornavn ? `Min side – ${fornavn}` : 'Min side'}
          </h2>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Lag nytt eventyr
          </button>
        </div>

        {/* The plan the user is on */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-indigo-100 dark:border-indigo-900 bg-white dark:bg-gray-800 px-5 py-4">
          <p className="flex items-center gap-2 font-bold text-gray-800 dark:text-gray-100">
            <Crown className={`w-5 h-5 ${isPro ? 'text-amber-500' : 'text-gray-400'}`} />
            Du bruker {isPro ? 'Pro' : 'Gratis'}
          </p>
          <button
            type="button"
            onClick={onOpenPlan}
            className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline"
          >
            {isPro ? 'Se hva som er med' : 'Se hva du får med Pro'}
          </button>
        </div>

        {/* Saved stories — first, because that is what people come here for. */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <Library className="w-7 h-7 text-indigo-600 dark:text-indigo-300" />
            <h3 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
              Mine eventyr{savedStories.length > 0 ? ` (${savedStories.length})` : ''}
            </h3>
          </div>

          {savedStories.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-6 sm:p-8 text-center">
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                Du har ingen lagrede eventyr ennå. Trykk «Lagre eventyr» på siste side for å finne det igjen her.
              </p>
              <Button onClick={onBack} variant="primary" className="inline-flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Lag et eventyr
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {savedStories.map((story) => (
                <div
                  key={story.id}
                  onClick={() => onLoadStory(story)}
                  className="group bg-white dark:bg-gray-800 rounded-xl p-5 shadow-md border border-indigo-50 dark:border-indigo-900 hover:shadow-xl hover:border-indigo-200 dark:hover:border-indigo-700 transition-all duration-300 cursor-pointer relative overflow-hidden flex flex-col"
                >
                  <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-400 to-purple-400"></div>

                  <div className="mb-4 flex-grow">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-900/50 px-2 py-1 rounded">
                        {normalizeAgeGroup(story.options.ageGroup)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(story.createdAt).toLocaleDateString('no-NO')}
                      </span>
                    </div>
                    <h4 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
                      {story.options.character}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                      {story.options.metaphor}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <div className="flex items-center text-indigo-600 dark:text-indigo-300 font-semibold text-sm group-hover:translate-x-1 transition-transform">
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Les på nytt
                    </div>
                    <button
                      onClick={(e) => onDeleteStory(e, story.id)}
                      className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full transition-colors"
                      title="Slett eventyret"
                      aria-label="Slett eventyret"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Remembered choices */}
        <section className="space-y-6 sm:space-y-8 bg-white dark:bg-gray-800 p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl border-2 border-indigo-100 dark:border-indigo-900">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Mine valg</h3>
              <p
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                  saveState === 'account-failed'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {saveState !== 'idle' && <CheckCircle className="w-4 h-4" />}
                {SAVE_TEXT[saveState]}
              </p>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Brukes på alle nye eventyr, og lagres med en gang du velger.
              {!innlogget && canLogIn && ' Logg inn med Vipps for å ha valgene og eventyrene med deg på alle enheter.'}
            </p>
          </div>

          <SelectionSection
            icon={<Calendar className="w-6 h-6 text-pink-500" />}
            title="Alder"
            options={AGE_GROUPS}
            value={normalizeAgeGroup(preferences.ageGroup)}
            onChange={(v) => onPreferenceChange({ ageGroup: v })}
          />

          <div className="space-y-3 sm:space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-700">
              <Palette className="w-6 h-6 text-emerald-500" />
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Tegnestil</h3>
              {!isPro && <ProBadge />}
            </div>
            {!isPro && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Med Gratis tegnes eventyrene i akvarell. Pro lar deg velge mellom alle fire.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {ART_STYLES.map((style) => {
                const isSelected = artStyle === style;
                const art = styleArt(PREVIEW_HERO, style);
                return (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => (isPro ? onPreferenceChange({ artStyle: style }) : onOpenPlan())}
                    className={`group relative p-2 rounded-2xl border-2 flex flex-col items-center text-center gap-1.5 transition-all duration-200 ${cardClass(isSelected)} ${!isPro && !isSelected ? 'opacity-60' : ''}`}
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
        </section>
      </div>
    </div>
  );
};

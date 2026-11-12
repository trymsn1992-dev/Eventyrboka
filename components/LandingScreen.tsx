import React from 'react';
import { CHARACTERS, FREE_STORIES_PER_WEEK } from '../types';
import { HERO_ART } from './SetupScreen';
import { logEvent } from '../services/analytics';
import { BookOpen, Heart, Sparkles } from 'lucide-react';

interface LandingScreenProps {
  // Vipps login is set up and can be offered.
  canLogIn: boolean;
}

const STEPS = [
  {
    icon: <Sparkles className="w-6 h-6" />,
    title: 'Velg helt og lærepenge',
    text: 'Seks helter med hver sin personlighet, og en lærepenge dere vil snakke om.',
  },
  {
    icon: <BookOpen className="w-6 h-6" />,
    title: 'Barnet bestemmer underveis',
    text: 'På hver side velger barnet hva som skal skje, og neste side skrives og tegnes ut fra valget.',
  },
  {
    icon: <Heart className="w-6 h-6" />,
    title: 'Lagre og les igjen',
    text: 'Eventyrene dere liker best lagres på Min side, klare til neste leggetid.',
  },
];

// What people see before they are logged in: what Magiboka is, and the way in.
export const LandingScreen: React.FC<LandingScreenProps> = ({ canLogIn }) => (
  <div className="w-full flex flex-col items-center pt-3 pb-8 sm:pt-6 sm:pb-12 px-3 sm:px-6 lg:px-8">
    <div className="max-w-4xl w-full space-y-8 sm:space-y-10 bg-white dark:bg-gray-800 p-6 sm:p-10 rounded-2xl sm:rounded-3xl shadow-2xl border-2 sm:border-4 border-indigo-100 dark:border-indigo-900">
      <div className="text-center space-y-4">
        <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight leading-tight">
          Eventyr der barnet bestemmer hva som skjer
        </h1>
        <p className="max-w-2xl mx-auto text-base sm:text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
          Magiboka skriver og tegner et helt nytt eventyr til dere på et øyeblikk. Dere velger helten
          og hva dere vil lære, og barnet velger veien videre på hver side.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3" aria-hidden="true">
        {CHARACTERS.map((char) => (
          <div key={char} className="aspect-square rounded-2xl bg-white overflow-hidden shadow-md ring-1 ring-indigo-100 dark:ring-indigo-900">
            <img src={HERO_ART[char]} alt="" width={480} height={480} className="w-full h-full object-cover scale-110" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {STEPS.map((step, i) => (
          <div key={step.title} className="rounded-2xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 p-4 sm:p-5">
            <div className="flex items-center gap-3 mb-2">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-200">
                {step.icon}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100 leading-tight">
                {i + 1}. {step.title}
              </h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{step.text}</p>
          </div>
        ))}
      </div>

      <div className="text-center space-y-3">
        {canLogIn ? (
          <a
            href="/api/vipps/start"
            onClick={() => logEvent('Vipps-innlogging klikket')}
            className="inline-flex items-center justify-center px-8 py-4 rounded-full bg-[#FF5B24] text-[#1A0B05] text-lg sm:text-xl font-bold hover:bg-[#FF7445] shadow-xl hover:shadow-2xl transform hover:-translate-y-0.5 transition-all"
          >
            Logg inn med Vipps og lag et eventyr
          </a>
        ) : (
          <p className="text-gray-600 dark:text-gray-300 font-semibold">
            Innlogging er ikke tilgjengelig akkurat nå. Prøv igjen om litt.
          </p>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Gratis å bruke – {FREE_STORIES_PER_WEEK} nye eventyr hver uke. Vi lagrer bare fornavnet ditt.
        </p>
      </div>
    </div>
  </div>
);

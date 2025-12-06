
import React, { useState } from 'react';
import { StoryOptions, CHARACTERS, METAPHORS, THEMES, GENRES, AGE_GROUPS, DURATIONS, SavedStory } from '../types';
import { Button } from './Button';
import { BookOpen, Sparkles, User, Lightbulb, Map, Theater, Calendar, Library, Trash2, PlayCircle, Clock } from 'lucide-react';

interface SetupScreenProps {
  onStart: (options: StoryOptions) => void;
  isLoading: boolean;
  savedStories?: SavedStory[];
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
        <svg viewBox="0 0 100 100" className={`w-24 h-24 ${bgClass} ${transition}`}>
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
        <svg viewBox="0 0 100 100" className={`w-24 h-24 ${bgClass} ${transition}`}>
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
        <svg viewBox="0 0 100 100" className={`w-24 h-24 ${bgClass} ${transition}`}>
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
        <svg viewBox="0 0 100 100" className={`w-24 h-24 ${bgClass} ${transition}`}>
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
        <svg viewBox="0 0 100 100" className={`w-24 h-24 ${bgClass} ${transition}`}>
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
        <svg viewBox="0 0 100 100" className={`w-24 h-24 ${bgClass} ${transition}`}>
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

const ThemeIcon = ({ name, selected }: { name: string, selected: boolean }) => {
  const bgClass = selected ? "scale-110 drop-shadow-xl filter saturate-110" : "grayscale-[0.3] hover:grayscale-0 hover:scale-105";
  const transition = "transition-all duration-300 ease-in-out";

  switch (name) {
    case "Fjelltur":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
           <path d="M10 80 L40 30 L70 80 Z" fill="#90A4AE" stroke="#546E7A" strokeWidth="1"/>
           <path d="M50 80 L75 40 L100 80 Z" fill="#B0BEC5" stroke="#78909C" strokeWidth="1"/>
           {/* Snow */}
           <path d="M40 30 L50 45 L45 50 L30 45 Z" fill="white"/>
           <path d="M75 40 L85 55 L75 60 L65 55 Z" fill="white"/>
           {/* Sun */}
           <circle cx="85" cy="20" r="10" fill="#FDD835" />
           <path d="M10 80 L90 80" stroke="#4CAF50" strokeWidth="4" strokeLinecap="round"/>
        </svg>
      );
    case "Fotballkamp":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
          <circle cx="50" cy="50" r="30" fill="white" stroke="#212121" strokeWidth="2"/>
          {/* Patches */}
          <path d="M50 50 L60 43 L70 50 L70 62 L60 69 L50 62 Z" fill="#212121"/>
          <path d="M50 50 L40 43 L30 50 L30 62 L40 69 L50 62 Z" fill="none" stroke="#212121" strokeWidth="1"/>
          <path d="M60 43 L60 30" stroke="#212121" strokeWidth="2"/>
          <path d="M40 43 L40 30" stroke="#212121" strokeWidth="2"/>
          <path d="M30 50 L20 45" stroke="#212121" strokeWidth="2"/>
          <path d="M70 50 L80 45" stroke="#212121" strokeWidth="2"/>
          <path d="M50 69 L50 80" stroke="#212121" strokeWidth="2"/>
          {/* Grass */}
          <rect x="10" y="80" width="80" height="10" fill="#4CAF50" rx="5"/>
        </svg>
      );
    case "Bursdag":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
          <rect x="20" y="50" width="60" height="30" rx="2" fill="#8D6E63" />
          <rect x="15" y="50" width="70" height="10" rx="5" fill="#F48FB1" /> {/* Frosting */}
          <rect x="30" y="30" width="40" height="20" rx="2" fill="#A1887F" />
          <rect x="25" y="30" width="50" height="8" rx="4" fill="#F48FB1" />
          {/* Candles */}
          <rect x="40" y="15" width="4" height="15" fill="#E3F2FD" stroke="#90CAF9" />
          <rect x="56" y="15" width="4" height="15" fill="#E3F2FD" stroke="#90CAF9" />
          {/* Flames */}
          <ellipse cx="42" cy="10" rx="3" ry="6" fill="#FF9800" />
          <ellipse cx="58" cy="10" rx="3" ry="6" fill="#FF9800" />
          {/* Confetti */}
          <circle cx="15" cy="20" r="2" fill="#4CAF50"/>
          <circle cx="85" cy="30" r="2" fill="#9C27B0"/>
          <circle cx="80" cy="10" r="2" fill="#F44336"/>
        </svg>
      );
    case "Dugnad":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
          {/* Trash bag */}
          <path d="M60 40 C60 40 80 40 85 60 C90 80 80 90 60 90 C40 90 35 80 35 60 C35 40 60 40 60 40" fill="#424242" />
          <path d="M55 35 L65 35" stroke="#424242" strokeWidth="4" strokeLinecap="round"/>
          {/* Rake */}
          <line x1="30" y1="90" x2="45" y2="20" stroke="#8D6E63" strokeWidth="4" strokeLinecap="round"/>
          <path d="M35 20 L55 20" stroke="#388E3C" strokeWidth="2"/>
          <path d="M35 20 L32 10 M40 20 L40 8 M45 20 L48 8 M50 20 L56 10" stroke="#388E3C" strokeWidth="2"/>
          {/* Leaf */}
          <path d="M20 80 Q10 70 20 60 Q30 70 20 80" fill="#FF5722" />
        </svg>
      );
    case "Skattejakt":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
           {/* Map */}
           <path d="M15 20 L85 20 L85 80 L15 80 Z" fill="#FFF176" stroke="#FBC02D" strokeWidth="2"/>
           {/* Fold lines */}
           <line x1="38" y1="20" x2="38" y2="80" stroke="#F9A825" strokeWidth="1" />
           <line x1="62" y1="20" x2="62" y2="80" stroke="#F9A825" strokeWidth="1" />
           {/* Trail */}
           <path d="M25 70 Q35 50 50 60 T75 30" fill="none" stroke="#B71C1C" strokeWidth="2" strokeDasharray="4,2"/>
           {/* X */}
           <path d="M70 25 L80 35 M80 25 L70 35" stroke="#B71C1C" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      );
    case "Romreise":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
          {/* Background Planet */}
          <circle cx="50" cy="50" r="35" fill="#1A237E" />
          <circle cx="20" cy="20" r="2" fill="white" opacity="0.8"/>
          <circle cx="80" cy="30" r="3" fill="white" opacity="0.6"/>
          <circle cx="60" cy="80" r="2" fill="white" opacity="0.9"/>
          
          {/* Rocket */}
          <path d="M45 70 L55 70 L55 40 Q50 25 45 40 Z" fill="#E0E0E0" />
          <path d="M45 40 L55 40" fill="none" stroke="#BDBDBD" strokeWidth="1"/>
          <circle cx="50" cy="45" r="3" fill="#29B6F6" stroke="#455A64" strokeWidth="1"/>
          {/* Fins */}
          <path d="M45 60 L40 70 L45 70" fill="#F44336" />
          <path d="M55 60 L60 70 L55 70" fill="#F44336" />
          {/* Flame */}
          <path d="M48 70 L52 70 L50 80 Z" fill="#FF9800" />
        </svg>
      );
    case "Undervannseventyr":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
           <rect x="10" y="10" width="80" height="80" rx="10" fill="#E0F7FA" stroke="#00BCD4" strokeWidth="2"/>
           {/* Seaweed */}
           <path d="M20 90 Q25 70 20 60 Q15 50 20 40" stroke="#4CAF50" strokeWidth="3" fill="none" />
           <path d="M30 90 Q25 75 30 65" stroke="#8BC34A" strokeWidth="3" fill="none" />
           {/* Bubbles */}
           <circle cx="70" cy="30" r="3" fill="#B2EBF2" stroke="#00ACC1" strokeWidth="1"/>
           <circle cx="65" cy="40" r="2" fill="#B2EBF2" stroke="#00ACC1" strokeWidth="1"/>
           {/* Fish */}
           <path d="M60 60 Q70 55 80 60 Q70 65 60 60 Z" fill="#FF9800" />
           <path d="M80 60 L85 55 V65 Z" fill="#FF9800" />
        </svg>
      );
    case "Sirkus":
      return (
        <svg viewBox="0 0 100 100" className={`w-20 h-20 ${bgClass} ${transition}`}>
          {/* Tent */}
          <path d="M20 80 L50 30 L80 80 Z" fill="#F44336" />
          <path d="M50 30 L50 80" stroke="rgba(255,255,255,0.5)" strokeWidth="2"/>
          <path d="M35 55 L35 80" stroke="rgba(255,255,255,0.5)" strokeWidth="2"/>
          <path d="M65 55 L65 80" stroke="rgba(255,255,255,0.5)" strokeWidth="2"/>
          <path d="M50 30 L35 55 L20 80 L80 80 L65 55 Z" fill="none" stroke="#D32F2F" strokeWidth="1"/>
          {/* Stripes */}
          <path d="M40 46 L45 80" stroke="white" strokeWidth="4"/>
          <path d="M60 46 L55 80" stroke="white" strokeWidth="4"/>
          {/* Flag */}
          <path d="M50 30 L50 15" stroke="#333" strokeWidth="1"/>
          <path d="M50 15 L65 20 L50 25" fill="#FFD600" />
        </svg>
      );
    default:
      return <Map className="w-10 h-10 text-gray-400" />;
  }
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ 
  onStart, 
  isLoading,
  savedStories = [],
  onLoadStory,
  onDeleteStory
}) => {
  const [options, setOptions] = useState<StoryOptions>({
    character: CHARACTERS[0],
    metaphor: METAPHORS[0],
    theme: THEMES[0],
    genre: GENRES[0],
    ageGroup: AGE_GROUPS[2],
    duration: DURATIONS[1]
  });

  const handleChange = (key: keyof StoryOptions, value: string) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart(options);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-8 bg-white p-8 rounded-3xl shadow-2xl border-4 border-indigo-100 mb-12">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-indigo-100 rounded-full flex items-center justify-center mb-4">
            <BookOpen className="h-10 w-10 text-indigo-600" />
          </div>
          <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">Lag ditt eventyr!</h2>
          <p className="mt-3 text-lg text-gray-600">
            Trykk på bildene under for å velge hva historien skal handle om.
          </p>
        </div>

        <form className="mt-10 space-y-12" onSubmit={handleSubmit}>
          
          {/* 1. Character Selection Grid */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100">
              <User className="w-6 h-6 text-indigo-500" />
              <h3 className="text-xl font-bold text-gray-800">Hvem er helten?</h3>
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
                      p-4 rounded-2xl text-left transition-all duration-200
                      border-2 flex flex-col items-center justify-between text-center gap-3 h-full min-h-[160px]
                      ${isSelected 
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-md ring-2 ring-indigo-200 ring-offset-2' 
                        : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-gray-50'
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

          {/* 2. Theme Selection (Hvor skjer det?) - Now with SVG Icons */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 border-gray-100">
              <Map className="w-6 h-6 text-green-500" />
              <h3 className="text-xl font-bold text-gray-800">Hvor skjer det?</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {THEMES.map((theme) => {
                const isSelected = options.theme === theme;
                return (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => handleChange('theme', theme)}
                    className={`
                      p-3 rounded-2xl text-left transition-all duration-200
                      border-2 flex flex-col items-center justify-between text-center gap-2 h-full min-h-[140px]
                      ${isSelected 
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-md ring-2 ring-indigo-200 ring-offset-2' 
                        : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-gray-50'
                      }
                    `}
                  >
                    <div className="flex-grow flex items-center justify-center w-full">
                      <ThemeIcon name={theme} selected={isSelected} />
                    </div>
                    <span className="text-sm font-bold leading-tight">{theme}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Metaphor Selection (Hva skal vi lære?) */}
          <SelectionSection
            icon={<Lightbulb className="w-6 h-6 text-amber-500" />}
            title="Hva skal vi lære?"
            options={METAPHORS}
            value={options.metaphor}
            onChange={(v) => handleChange('metaphor', v)}
          />

          {/* 4. Duration Selection (Hvor lenge skal vi lese?) */}
          <SelectionSection
             icon={<Clock className="w-6 h-6 text-blue-500" />}
             title="Hvor lenge skal vi lese?"
             options={DURATIONS}
             value={options.duration}
             onChange={(v) => handleChange('duration', v)}
          />

          {/* 5. Genre & Age Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <SelectionSection
              icon={<Theater className="w-6 h-6 text-purple-500" />}
              title="Sjanger"
              options={GENRES}
              value={options.genre}
              onChange={(v) => handleChange('genre', v)}
            />
            
            <SelectionSection
              icon={<Calendar className="w-6 h-6 text-pink-500" />}
              title="Alder"
              options={AGE_GROUPS}
              value={options.ageGroup}
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
            <h3 className="text-3xl font-bold text-gray-800 font-serif">Mitt Bibliotek</h3>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {savedStories.map((story) => (
              <div 
                key={story.id}
                onClick={() => onLoadStory && onLoadStory(story)}
                className="group bg-white rounded-xl p-5 shadow-md border border-indigo-50 hover:shadow-xl hover:border-indigo-200 transition-all duration-300 cursor-pointer relative overflow-hidden flex flex-col"
              >
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-400 to-purple-400"></div>
                
                <div className="mb-4 flex-grow">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-2 py-1 rounded">
                      {story.options.genre}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(story.createdAt).toLocaleDateString('no-NO')}
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-indigo-700 transition-colors">
                    {story.options.character}
                  </h4>
                  <p className="text-sm text-gray-500 line-clamp-2">
                     Tema: {story.options.theme}
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
  <div className="space-y-4">
    <div className="flex items-center gap-2 border-b pb-2 border-gray-100">
      {icon}
      <h3 className="text-xl font-bold text-gray-800">{title}</h3>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-2 gap-3"> {/* Force 2 columns for even grids */}
      {options.map((opt) => {
        const isSelected = value === opt;
        const itemIcon = iconMap ? iconMap[opt] : null;
        
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`
              p-3 rounded-xl text-left transition-all duration-200
              border-2 flex flex-col items-center justify-center text-center gap-2 h-full min-h-[100px]
              ${isSelected 
                ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-md scale-105 ring-2 ring-indigo-200 ring-offset-1' 
                : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-gray-50'
              }
            `}
          >
            {itemIcon && <span className="text-4xl mb-1">{itemIcon}</span>}
            <span className="text-sm font-semibold">{opt}</span>
          </button>
        );
      })}
    </div>
  </div>
);

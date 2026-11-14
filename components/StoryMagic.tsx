import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ScrollText, Sparkles } from 'lucide-react';
import { DEFAULT_ART_STYLE, StoryOptions } from '../types';
import { MORAL_ART, styleArt } from './SetupScreen';
import { loadOwnHero } from '../services/hero';
import { cachedCollection } from '../services/samling';

// Shown while a new story is being made: the hero and the moral the family
// picked float in under a night sky, and stardust streams from both of them
// into a glowing book — the two become one fairy tale.

// The picture of the picked hero: a built-in hero in the picked drawing
// style, or the sheet of a hero the family made themselves.
const heroPicture = (options: StoryOptions): string | undefined => {
  const builtIn = styleArt(options.character, options.artStyle ?? DEFAULT_ART_STYLE);
  if (builtIn) return builtIn;
  if (!options.heroToken) return undefined;
  const own = loadOwnHero();
  if (own && own.token === options.heroToken) return own.sheet;
  return cachedCollection().heroes.find(h => h.token === options.heroToken)?.sheet;
};

// Stardust on its way from one of the two into the book. `side` is -1 for
// the hero (on the left) and 1 for the moral (on the right).
const SPARKS = [-1, 1].flatMap(side =>
  Array.from({ length: 6 }, (_, i) => ({
    side,
    delay: 1.4 + i * 0.4 + (side === 1 ? 0.2 : 0),
    size: 8 + ((i * 5) % 7),
    colour: ['#fde68a', '#fbbf24', '#c4b5fd'][i % 3],
  }))
);

export const StoryMagic: React.FC<{ options: StoryOptions }> = ({ options }) => {
  const hero = heroPicture(options);
  const moral = MORAL_ART[options.metaphor];

  const messages = useMemo(
    () => [
      `${options.character} gjør seg klar …`,
      'Lærepengen flettes inn i eventyret …',
      'Koker sammen litt magi …',
      'Spisser blyantene …',
      'Skriver så blekket spruter …',
      'Første side er snart klar …',
    ],
    [options.character]
  );
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep(s => s + 1), 3200);
    return () => window.clearInterval(timer);
  }, []);

  // The night sky. Placed once, so the stars keep still between renders.
  const sky = useMemo(
    () =>
      Array.from({ length: 34 }, () => ({
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        size: 1.5 + Math.random() * 2.5,
        delay: `${(Math.random() * 4).toFixed(2)}s`,
      })),
    []
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="story-magic fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden px-4 text-white"
    >
      <style>{`
        .story-magic {
          --w: min(86vw, 52vh, 440px);
          background: radial-gradient(ellipse at 50% 38%, #43308c 0%, #1d1650 50%, #0b0a26 100%);
          animation: sm-fade 0.4s ease-out both;
        }
        @keyframes sm-fade { from { opacity: 0; } }
        .sm-sky span {
          position: absolute;
          border-radius: 9999px;
          background: #fff;
          animation: sm-twinkle 3.6s ease-in-out infinite;
        }
        @keyframes sm-twinkle { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.9; } }

        .sm-stage { position: relative; width: var(--w); height: calc(var(--w) * 1.02); flex: none; }

        /* The hero and the moral, each in a glowing ring. */
        .sm-who {
          position: absolute;
          top: 0;
          width: 44%;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          animation: sm-arrive 0.9s cubic-bezier(0.2, 0.9, 0.3, 1.25) both;
        }
        .sm-hero  { left: 3%;  --from: -60%; animation-delay: 0.15s; }
        .sm-moral { right: 3%; --from: 60%;  animation-delay: 0.55s; }
        @keyframes sm-arrive {
          from { opacity: 0; transform: translate(var(--from), 20%) scale(0.3) rotate(-12deg); }
        }
        .sm-float { position: relative; width: 82%; aspect-ratio: 1; animation: sm-bob 4.5s ease-in-out infinite; }
        .sm-moral .sm-float { animation-delay: -2.2s; }
        @keyframes sm-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7%); } }
        .sm-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: conic-gradient(from 0deg, #fbbf24, #f472b6, #818cf8, #34d399, #fbbf24);
          box-shadow: 0 0 26px rgba(251, 191, 36, 0.55), 0 0 60px rgba(167, 139, 250, 0.45);
          animation: sm-spin 9s linear infinite;
        }
        @keyframes sm-spin { to { transform: rotate(360deg); } }
        .sm-face {
          position: absolute;
          inset: 4px;
          border-radius: 9999px;
          overflow: hidden;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sm-face img { width: 100%; height: 100%; object-fit: cover; object-position: top; }

        /* Stardust: sideways towards the middle, then down into the book. */
        .sm-spark { position: absolute; top: 20%; opacity: 0; animation: sm-across 2.4s ease-out infinite; }
        .sm-spark i {
          display: block;
          clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
          animation: sm-down 2.4s cubic-bezier(0.6, 0, 0.9, 0.6) infinite;
          animation-delay: inherit;
        }
        @keyframes sm-across {
          0%   { opacity: 0; transform: translateX(0); }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { opacity: 0; transform: translateX(calc(var(--w) * 0.25 * var(--dir))); }
        }
        @keyframes sm-down {
          from { transform: translateY(0) scale(1) rotate(0deg); }
          to   { transform: translateY(calc(var(--w) * 0.56)) scale(0.4) rotate(220deg); }
        }

        /* The book the story is written into. */
        .sm-book {
          position: absolute;
          left: 50%;
          bottom: 0;
          width: 34%;
          aspect-ratio: 1;
          margin-left: -17%;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: sm-book-in 0.8s ease-out 0.95s both;
        }
        @keyframes sm-book-in { from { opacity: 0; transform: translateY(30%) scale(0.5); } }
        .sm-glow {
          position: absolute;
          inset: -35%;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(253, 230, 138, 0.75) 0%, rgba(251, 191, 36, 0.28) 38%, rgba(251, 191, 36, 0) 68%);
          animation: sm-pulse 2.4s ease-in-out infinite;
        }
        @keyframes sm-pulse { 0%, 100% { transform: scale(0.85); opacity: 0.7; } 50% { transform: scale(1.1); opacity: 1; } }
        .sm-book svg { position: relative; width: 78%; height: 78%; color: #fffbeb; filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.9)); }

        .sm-message { animation: sm-message 0.5s ease-out both; }
        @keyframes sm-message { from { opacity: 0; transform: translateY(6px); } }

        @media (prefers-reduced-motion: reduce) {
          .story-magic, .story-magic * { animation: none !important; }
        }
      `}</style>

      <div className="sm-sky absolute inset-0" aria-hidden="true">
        {sky.map((star, i) => (
          <span
            key={i}
            style={{ left: star.left, top: star.top, width: star.size, height: star.size, animationDelay: star.delay }}
          />
        ))}
      </div>

      <div className="sm-stage">
        <div className="sm-who sm-hero">
          <div className="sm-float">
            <span className="sm-ring" aria-hidden="true" />
            <span className="sm-face">
              {hero ? <img src={hero} alt="" /> : <Sparkles className="w-1/2 h-1/2 text-amber-400" aria-hidden="true" />}
            </span>
          </div>
          <p className="mt-3 text-sm sm:text-base font-bold leading-tight drop-shadow">{options.character}</p>
        </div>

        <div className="sm-who sm-moral">
          <div className="sm-float">
            <span className="sm-ring" aria-hidden="true" />
            <span className="sm-face">
              {moral ? <img src={moral} alt="" /> : <ScrollText className="w-1/2 h-1/2 text-indigo-500" aria-hidden="true" />}
            </span>
          </div>
          <p className="mt-3 text-sm sm:text-base font-serif italic leading-tight drop-shadow line-clamp-3">
            «{options.metaphor}»
          </p>
        </div>

        {SPARKS.map((spark, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="sm-spark"
            style={{
              left: spark.side === -1 ? '25%' : '75%',
              animationDelay: `${spark.delay}s`,
              ['--dir' as string]: -spark.side,
            }}
          >
            <i style={{ width: spark.size, height: spark.size, background: spark.colour }} />
          </span>
        ))}

        <div className="sm-book" aria-hidden="true">
          <span className="sm-glow" />
          <BookOpen strokeWidth={1.6} />
        </div>
      </div>

      <h2 className="relative mt-6 text-2xl sm:text-3xl font-serif font-bold text-amber-100 text-center drop-shadow">
        Eventyret blir til
      </h2>
      <p key={step} className="sm-message relative mt-2 min-h-[1.5rem] text-sm sm:text-base text-indigo-100 text-center">
        {messages[step % messages.length]}
      </p>
    </div>
  );
};

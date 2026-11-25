// «Lag til print»: a whole book without choices, written in one go and made
// to be printed. The grown-up reads a summary first and may ask for another
// story once; then the pictures are drawn, the book is saved on Min side, and
// the print window opens. Costs one wish (see api/bok.ts).
import React, { useEffect, useRef, useState } from 'react';
import {
  HERO_NAME_MAX,
  OwnHero,
  SavedStory,
  SideCharacter,
  StoryOptions,
  StorySegment,
  DEFAULT_ART_STYLE,
  cleanHeroName,
} from '../types';
import { BookDraft, generateBook, generateCharacterSheet, generateIllustration } from '../services/geminiService';
import { loadOwnHero } from '../services/hero';
import { logEvent } from '../services/analytics';
import { PrintDialog } from './PrintDialog';
import { ArrowLeft, BookOpen, ChevronDown, Loader2, Printer, RefreshCw, Sparkles } from 'lucide-react';

interface PrintBookProps {
  options: StoryOptions;
  // A wish was spent (the book was written).
  onWishesSpent: (count: number) => void;
  // Something failed: ask the server again how many wishes there are.
  onRefreshWishes: () => void;
  // Keep the finished book on the account. False when it could not be saved.
  onSave: (story: SavedStory) => Promise<boolean>;
  // Read the finished book on screen instead.
  onRead: (story: SavedStory) => void;
  onBack: () => void;
}

type Phase = 'writing' | 'review' | 'drawing' | 'done' | 'failed';

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

// How many pictures are drawn at once.
const DRAW_AT_ONCE = 3;

const CARD =
  'w-full max-w-2xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-5 py-6 sm:p-8 sm:rounded-3xl sm:shadow-2xl sm:border-4 border-indigo-100 dark:border-indigo-900';
const PRIMARY =
  'w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-4 text-lg font-bold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors';
const SECONDARY =
  'w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-indigo-300 dark:border-indigo-600 px-4 py-3 text-base font-bold text-indigo-700 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 disabled:opacity-60 transition-colors';

export const PrintBook: React.FC<PrintBookProps> = ({
  options,
  onWishesSpent,
  onRefreshWishes,
  onSave,
  onRead,
  onBack,
}) => {
  const [phase, setPhase] = useState<Phase>('writing');
  const [draft, setDraft] = useState<BookDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The free rewrite that comes with the book, while it is unused.
  const [rewrite, setRewrite] = useState<{ pass: string; left: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Who the book is for: printed on the cover. Never sent to the story writer.
  const [childName, setChildName] = useState('');
  const [drawn, setDrawn] = useState(0);
  const [story, setStory] = useState<SavedStory | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [printing, setPrinting] = useState(false);
  const seedRef = useRef(0);
  // Left the page: results that land afterwards are dropped.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  const write = async (rewritePass?: string) => {
    setPhase('writing');
    setError(null);
    setShowAll(false);
    seedRef.current = Math.floor(Math.random() * 1_000_000_000);
    try {
      const result = await generateBook(options, seedRef.current, rewritePass);
      if (gone.current) return;
      if (result.wishes > 0) onWishesSpent(result.wishes);
      setDraft(result.draft);
      setRewrite(result.rewrite);
      setPhase('review');
    } catch (err) {
      if (gone.current) return;
      setError(err instanceof Error && err.message ? err.message : 'Kunne ikke lage historien. Prøv igjen.');
      setPhase('failed');
      onRefreshWishes();
    }
  };

  // Write the book as soon as the page opens — once (React runs effects
  // twice in development).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    logEvent('Print-bok startet');
    void write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRewrite = () => {
    if (!rewrite) return;
    logEvent('Print-bok skrevet på nytt');
    void write(rewrite.pass);
  };

  // Draw the character sheet and the five pictures, then save and print.
  const handleDraw = async () => {
    if (!draft) return;
    setPhase('drawing');
    setDrawn(0);
    setError(null);
    const sideCharacters: SideCharacter[] = draft.sideCharacters;
    // A hero made from a photo already has its sheet, when the style matches.
    const own: OwnHero | null = options.heroToken ? loadOwnHero() : null;
    const sheet =
      own && own.token === options.heroToken && own.artStyle === (options.artStyle ?? DEFAULT_ART_STYLE)
        ? own.sheet
        : await generateCharacterSheet(options.character, options.artStyle, options.heroToken);

    const segments: StorySegment[] = draft.pages.map((page, i) => ({
      text: page.text,
      illustrationPrompt: page.illustrationPrompt,
      // No real choices: one button that turns the page when read on screen.
      choices: i < draft.pages.length - 1 ? [{ text: 'Neste side', nextPlotPoint: '' }] : [],
      isEnding: i === draft.pages.length - 1,
      sideCharacters: i === 0 ? sideCharacters : [],
    }));
    const haystack = (s: StorySegment) => `${s.illustrationPrompt ?? ''} ${s.text}`.toLowerCase();
    const drawPage = async (i: number) => {
      const named = sideCharacters.filter(c => haystack(segments[i]).includes(c.name.toLowerCase()));
      const cast = (named.length ? named : sideCharacters).slice(0, 3);
      // One more try if the picture didn't come.
      const image =
        (await generateIllustration(segments[i], options, cast, sheet)) ??
        (await generateIllustration(segments[i], options, cast, sheet));
      if (image) segments[i] = { ...segments[i], imageBase64: image };
      if (!gone.current) setDrawn(n => n + 1);
    };
    const queue = segments.map((_, i) => i);
    await Promise.all(
      Array.from({ length: DRAW_AT_ONCE }, async () => {
        while (queue.length > 0) {
          const i = queue.shift();
          if (i !== undefined) await drawPage(i);
        }
      })
    );
    if (gone.current) return;

    const name = cleanHeroName(childName);
    const finished: SavedStory = {
      id: newId(),
      createdAt: Date.now(),
      options,
      segments,
      seed: seedRef.current,
      premise: draft.summary,
      linear: true,
      ...(draft.title ? { title: draft.title } : {}),
      ...(name ? { dedication: name } : {}),
    };
    setStory(finished);
    setPhase('done');
    setPrinting(true);
    logEvent('Print-bok ferdig');
    // It is paid for: keep it on Min side, whatever happens to the printout.
    const ok = await onSave(finished);
    if (!gone.current) setSaved(ok);
  };

  const missingPictures = story ? story.segments.filter(s => !s.imageBase64).length : 0;

  return (
    <div className="min-h-screen sm:min-h-0 -mx-4 -mt-4 -mb-4 w-[calc(100%+2rem)] sm:mx-0 sm:mt-0 sm:mb-0 sm:w-full flex flex-col items-center sm:pt-4 sm:pb-12 sm:px-6">
      <div className={CARD}>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Tilbake
        </button>

        {phase === 'writing' && (
          <div className="py-16 text-center" role="status">
            <Loader2 className="mx-auto w-10 h-10 animate-spin text-indigo-500" />
            <p className="mt-4 text-xl font-extrabold text-gray-900 dark:text-gray-100">Skriver hele boka …</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Det tar vanligvis under et halvt minutt. Bildene tegnes etter at du har sett over historien.
            </p>
          </div>
        )}

        {phase === 'failed' && (
          <div className="py-12 text-center">
            <p role="alert" className="text-lg font-bold text-amber-700 dark:text-amber-300">
              {error}
            </p>
            <div className="mt-6 space-y-3">
              <button type="button" onClick={() => void write()} className={PRIMARY}>
                <RefreshCw className="w-5 h-5" />
                Prøv igjen
              </button>
              <button type="button" onClick={onBack} className={SECONDARY}>
                Tilbake
              </button>
            </div>
          </div>
        )}

        {phase === 'review' && draft && (
          <div className="mt-4 space-y-6">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-300">
                Se over før vi tegner
              </p>
              <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                {draft.title || `Eventyret om ${options.character}`}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {options.character} · {options.metaphor}
              </p>
            </div>

            <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 p-4">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Kort om historien</p>
              <p className="mt-1 leading-relaxed text-gray-800 dark:text-gray-100">{draft.summary}</p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAll(v => !v)}
                aria-expanded={showAll}
                className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showAll ? 'rotate-180' : ''}`} />
                {showAll ? 'Skjul hele historien' : 'Les hele historien'}
              </button>
              {showAll && (
                <ol className="mt-3 space-y-4">
                  {draft.pages.map((page, i) => (
                    <li key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Side {i + 1}</p>
                      <p className="mt-1 whitespace-pre-line font-serif leading-relaxed text-gray-900 dark:text-gray-100">
                        {page.text}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <label className="block">
              <span className="block mb-1 text-sm font-bold text-gray-900 dark:text-gray-100">
                Hvem er boka til? (valgfritt)
              </span>
              <input
                type="text"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                maxLength={HERO_NAME_MAX}
                placeholder="F.eks. Emma"
                className="w-full rounded-xl border-2 border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-900 px-4 py-3 text-base font-semibold text-gray-900 dark:text-gray-100 placeholder:font-normal placeholder:text-gray-400 focus:outline-none focus:border-indigo-500"
              />
              <span className="block mt-1 text-xs text-gray-500 dark:text-gray-400">
                Navnet står på forsiden av boka. Det brukes ikke til noe annet.
              </span>
            </label>

            <div className="space-y-3">
              <button type="button" onClick={handleDraw} className={PRIMARY}>
                <Sparkles className="w-5 h-5" />
                Tegn bildene og gjør klar til print
              </button>
              {rewrite && rewrite.left > 0 ? (
                <button type="button" onClick={handleRewrite} className={SECONDARY}>
                  <RefreshCw className="w-5 h-5" />
                  Lag en ny historie (gratis, {rewrite.left} forsøk igjen)
                </button>
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                  Det gratis forsøket på en ny historie er brukt.
                </p>
              )}
            </div>
          </div>
        )}

        {phase === 'drawing' && draft && (
          <div className="py-16 text-center" role="status">
            <Loader2 className="mx-auto w-10 h-10 animate-spin text-indigo-500" />
            <p className="mt-4 text-xl font-extrabold text-gray-900 dark:text-gray-100">
              {drawn === 0
                ? 'Tegner helten og de første bildene …'
                : `Tegner bilde ${Math.min(drawn + 1, draft.pages.length)} av ${draft.pages.length} …`}
            </p>
            <div className="mx-auto mt-4 h-2 w-56 overflow-hidden rounded-full bg-indigo-100 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                style={{ width: `${Math.round((drawn / draft.pages.length) * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Det tar omtrent ett minutt. La siden stå åpen.</p>
          </div>
        )}

        {phase === 'done' && story && (
          <div className="mt-4 space-y-6 text-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-gray-100">Boka er klar!</h2>
              <p className="mt-1 text-gray-600 dark:text-gray-300">{story.title || `Eventyret om ${options.character}`}</p>
            </div>
            <div className="flex justify-center gap-2">
              {story.segments.map((seg, i) =>
                seg.imageBase64 ? (
                  <img
                    key={i}
                    src={seg.imageBase64}
                    alt=""
                    className="w-14 h-[4.6rem] sm:w-20 sm:h-[6.6rem] rounded-lg object-cover border border-indigo-100 dark:border-indigo-900"
                  />
                ) : null
              )}
            </div>
            {missingPictures > 0 && (
              <p role="status" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                {missingPictures === 1 ? 'Ett bilde' : `${missingPictures} bilder`} lot seg ikke tegne. Boka kan
                skrives ut likevel.
              </p>
            )}
            <div className="space-y-3">
              <button type="button" onClick={() => setPrinting(true)} className={PRIMARY}>
                <Printer className="w-5 h-5" />
                Skriv ut boka
              </button>
              <button type="button" onClick={() => onRead(story)} className={SECONDARY}>
                <BookOpen className="w-5 h-5" />
                Les på skjermen
              </button>
            </div>
            <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
              {saved === null
                ? 'Lagrer boka på Min side …'
                : saved
                  ? 'Boka er lagret på Min side, så du kan skrive den ut igjen senere.'
                  : 'Boka ble ikke lagret på Min side. Skriv den ut nå, mens den er her.'}
            </p>
          </div>
        )}
      </div>

      {printing && story && <PrintDialog story={story} onClose={() => setPrinting(false)} />}
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { SetupScreen } from './components/SetupScreen';
import { BookPage } from './components/BookPage';
import { PageTurnAnimation } from './components/PageTurnAnimation';
import { StoryOptions, StorySegment, Choice, SavedStory, StoryPlan, DURATIONS, TOTAL_PAGES } from './types';
import { generateCharacterSheet, generateIllustration, generateFullBook, generateOpener } from './services/geminiService';
import {
  AccountStatus,
  deleteStory as deleteStoryAccount,
  emptyStatus,
  fetchStatus,
  loadStories,
  logout,
  saveStory as saveStoryAccount,
} from './services/account';
import { AlertCircle, LogOut, MessageSquare, Sun, Moon } from 'lucide-react';

const FEEDBACK_URL = 'https://grinas.typeform.com/to/sFjrTX2j';

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const App: React.FC = () => {
  const [view, setView] = useState<'setup' | 'reading'>('setup');
  const [options, setOptions] = useState<StoryOptions | null>(null);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedStories, setSavedStories] = useState<SavedStory[]>([]);
  // Which segment the reader is currently viewing. We only advance this when
  // they click "Neste side"; the segments array can grow underneath while
  // they read the bridge on the current page.
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // Theme state. The initial `dark` class is set by an inline script in
  // index.html that reads localStorage + prefers-color-scheme before React
  // mounts, so the page doesn't flash the wrong background on cold load.
  // We mirror that into React state here so the toggle button can flip it.
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });
  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', next === 'dark');
      }
      try {
        localStorage.setItem('magiboka_theme', next);
      } catch {
        // localStorage blocked in private mode — the class is still set,
        // the preference just won't survive reload. Fine for this session.
      }
      return next;
    });
  };

  // Account state. Drives the header login/logout UI and decides whether
  // story reads/writes go to Supabase or stay in the browser.
  const [account, setAccount] = useState<AccountStatus>(emptyStatus());

  // Hide feedback banner + header on scroll down, reveal on scroll up.
  // Keeps the illustration prominent while reading, without permanently
  // losing access to the logo (restart) or feedback link.
  const [chromeVisible, setChromeVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  useEffect(() => {
    const SHOW_THRESHOLD = 50;
    const DELTA = 6;
    const handleScroll = () => {
      const y = window.scrollY;
      const last = lastScrollYRef.current;
      if (y < SHOW_THRESHOLD) {
        setChromeVisible(true);
      } else if (y > last + DELTA) {
        setChromeVisible(false);
      } else if (y < last - DELTA) {
        setChromeVisible(true);
      }
      lastScrollYRef.current = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Ask the server who we are. On success we also reload the story list,
  // because logged-in users read from Supabase while guests read from
  // IndexedDB, and we don't know which until the status lands.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await fetchStatus();
      if (cancelled) return;
      setAccount(status);
      try {
        const stories = await loadStories(status.innlogget);
        if (!cancelled) setSavedStories(stories);
      } catch (e) {
        console.error('Failed to load stories', e);
        if (!cancelled) setError('Kunne ikke laste lagrede historier.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Show a short confirmation when the user comes back from Vipps.
  // ?vipps=ok / ?vipps=feil / ?vipps=avbrutt are set by /api/vipps/tilbake.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('vipps');
    if (!code) return;
    const message: Record<string, string> = {
      ok: 'Du er logget inn.',
      avbrutt: 'Vipps-innloggingen ble avbrutt.',
      feil: 'Vipps-innloggingen feilet. Prøv igjen.',
      'ikke-klar': 'Vipps-innlogging er ikke satt opp ennå.',
      oppdater: 'Du må oppdatere Vipps-appen for å logge inn.',
    };
    const msg = message[code];
    if (msg && code !== 'ok') setError(msg);
    params.delete('vipps');
    const url =
      window.location.pathname +
      (params.toString() ? `?${params.toString()}` : '') +
      window.location.hash;
    window.history.replaceState(null, '', url);
  }, []);

  const handleLogout = async () => {
    await logout();
    setAccount({ ...account, innlogget: false, fornavn: '' });
    // After sign-out, the user sees their local IndexedDB stories again.
    try {
      const stories = await loadStories(false);
      setSavedStories(stories);
    } catch {
      setSavedStories([]);
    }
  };

  // Attaches the illustration for a segment in the background, updating state
  // in place when the image lands. The reader can start reading while this runs.
  const attachIllustrationAt = async (
    index: number,
    segment: StorySegment,
    opts: StoryOptions,
    activePlan: StoryPlan | undefined,
    sheetPromise: Promise<string | undefined>
  ) => {
    const sheet = await sheetPromise;
    const image = await generateIllustration(segment, opts, activePlan, sheet);
    if (!image) return;
    setSegments(prev => {
      const next = [...prev];
      if (next[index]) next[index] = { ...next[index], imageBase64: image };
      return next;
    });
  };

  // Hybrid two-stage flow — the one and only path.
  //
  // Stage 1 — Fast opener (lite model, ~3-5s): writes page 1 so the reader
  // sees a scene immediately. The character sheet and page 1's image start
  // generating in parallel at the moment the user clicks Start, so they
  // have the longest possible head start.
  //
  // Stage 2 — Full book (big model, ~40-50s): called with the opener as
  // context so it writes pages 2–5 that continue naturally from page 1.
  // This runs in the background while the reader reads page 1; by the
  // time they tap to the next page, everything is already in state.
  //
  // On choice click no server round trip happens — see handleChoice.
  const handleStartStory = async (selectedOptions: StoryOptions) => {
    setOptions(selectedOptions);
    setPlan(null);
    setCurrentPageIndex(0);
    setIsLoading(true);
    setError(null);
    try {
      // Fire the sheet immediately so it is ready by the time any image
      // call wants it. It does not block anything downstream.
      const sheetPromise = generateCharacterSheet(selectedOptions.character);

      // Stage 1: opener. Blocks until page 1 is ready — the single wait
      // the reader experiences before seeing the book.
      const opener = await generateOpener(selectedOptions);

      setSegments([opener]);
      setView('reading');
      setIsLoading(false);

      // Fire page 1's illustration as early as possible. We do not yet
      // have the sideCharacters list from the plan, so pass undefined;
      // page 1 rarely needs them and if it does the next pages' images
      // will catch the full plan.
      void attachIllustrationAt(0, opener, selectedOptions, undefined, sheetPromise);

      // Stage 2: the big call. Runs in the background while the reader
      // reads page 1. Pages 2–5 and the plan come back together.
      // Pass the opener's choices (text + bridge of each option) so the
      // model can write side 2 that converges from EITHER bridge.
      void (async () => {
        try {
          const book = await generateFullBook(selectedOptions, {
            text: opener.text,
            choices: opener.choices.map(c => ({ text: c.text, bridge: c.bridge ?? '' })),
          });

          const continuationSegments: StorySegment[] = book.pages.map(p => ({
            text: p.text,
            choices: p.choices,
            isEnding: p.isEnding,
            illustrationPrompt: p.illustrationPrompt,
          }));

          // Append sides 2–5 to the segments the reader is browsing.
          // currentPageIndex stays put — they advance manually with "Neste side".
          setSegments(prev => [...prev, ...continuationSegments]);

          // Fold the character sheet into the plan as soon as it lands
          // so saved stories and image calls alike have a full plan.
          void sheetPromise.then(sheet => {
            const composed: StoryPlan = {
              ...book.plan,
              characterSheetBase64: sheet,
            };
            setPlan(composed);
          });

          const planForImages: StoryPlan = {
            ...book.plan,
            characterSheetBase64: undefined,
          };

          // Fire the remaining illustration calls in parallel. Offset by
          // 1 because opener occupies index 0.
          continuationSegments.forEach((segment, offset) => {
            const index = 1 + offset;
            void attachIllustrationAt(
              index,
              segment,
              selectedOptions,
              planForImages,
              sheetPromise,
            );
          });
        } catch (err) {
          // Stage 2 failure is recoverable — the reader already sees
          // page 1. Surface the error so they know to try again or back
          // out before they hit the end of what we have.
          const msg = err instanceof Error ? err.message : "";
          console.warn("Book continuation failed:", err);
          setError(msg || "Klarte ikke å lage resten av historien. Prøv igjen.");
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg || "Beklager, vi klarte ikke å starte historien. Prøv igjen om et minutt.");
      setIsLoading(false);
    }
  };

  // Every page is already in `segments` from the two-stage generation.
  // The bridge is shown locally by BookPage; the "Neste side" button
  // advances `currentPageIndex`. No server round trip on choice click.
  const handleChoice = async (_choice: Choice) => {
    // No-op by design.
  };

  // Parent escape hatch: next page becomes the resolution regardless of
  // where we are in the arc. The resolution is already written as the
  // last segment; splice it right after the current page so the next
  // tap lands on it.
  const handleWrapUp = async () => {
    if (!options || segments.length === 0) return;
    const last = segments[segments.length - 1];
    setSegments(prev => [...prev.slice(0, currentPageIndex + 1), last]);
  };

  const handleRestart = () => {
    setSegments([]);
    setOptions(null);
    setPlan(null);
    setCurrentPageIndex(0);
    setView('setup');
    setError(null);
  };

  const handleNextPage = () => {
    setCurrentPageIndex(i => Math.min(i + 1, segments.length - 1));
  };

  const handleSaveStory = async (): Promise<boolean> => {
    if (!options || segments.length === 0) return false;

    const newStory: SavedStory = {
      id: generateId(),
      createdAt: Date.now(),
      options: options,
      segments: segments,
      plan: plan ?? undefined,
    };

    try {
      const ok = await saveStoryAccount(newStory, account.innlogget);
      if (!ok) throw new Error('save-failed');
      setSavedStories(prev => [newStory, ...prev]);
      return true;
    } catch (e) {
      console.error("Save error:", e);
      setError(account.innlogget
        ? "Kunne ikke lagre eventyret til kontoen din. Prøv igjen om litt."
        : "Kunne ikke lagre eventyret. Det kan hende disken er full.");
      return false;
    }
  };

  const handleLoadStory = (story: SavedStory) => {
    // Backward compatibility for stories saved before duration was added
    const storyOptions = { ...story.options };
    if (!storyOptions.duration) {
      storyOptions.duration = DURATIONS[1]; // Default to 5 min
    }

    setOptions(storyOptions);
    setPlan(story.plan ?? null);
    setSegments(story.segments);
    setCurrentPageIndex(0);
    setView('reading');
  };

  const handleDeleteStory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteStoryAccount(id, account.innlogget);
      setSavedStories(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      setError("Kunne ikke slette historien.");
    }
  };

  // The segment the reader is actually viewing. Separate from segments.length
  // so the next segment can be ready in the background while the reader
  // finishes the bridge text on the current page.
  const currentSegment = segments[currentPageIndex];
  // True when the next segment has arrived but the reader has not advanced yet.
  const isNextPageReady = currentPageIndex < segments.length - 1;

  // Every story is now exactly TOTAL_PAGES pages regardless of duration.
  const estimatedPages = TOTAL_PAGES;

  const isReading = view === 'reading';

  return (
    <div className={`${isReading ? 'h-screen overflow-hidden' : 'min-h-screen'} bg-[#e8e6e1] dark:bg-[#15161a] text-gray-900 dark:text-gray-100 transition-colors flex flex-col`}>
      {/* Chrome (feedback banner + header) only on the setup view.
          Reading gets the full viewport for the book, with a small
          floating Hjem button in the corner as the only control. */}
      {!isReading && (
        <div
          className={`sticky top-0 z-30 transition-transform duration-300 ease-out ${
            chromeVisible ? 'translate-y-0' : '-translate-y-full'
          }`}
        >
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm md:text-base py-2 px-4 flex items-center justify-center gap-2 hover:from-indigo-700 hover:to-purple-700 transition-colors"
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span className="text-center">
              Hjelp oss å gjøre Magiboka bedre — <span className="underline font-semibold">gi tilbakemelding</span>
            </span>
          </a>
          <header className="bg-white dark:bg-gray-900 shadow-sm py-4 px-6">
            <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
              <button onClick={handleRestart} className="flex items-center cursor-pointer" aria-label="Magiboka — til forsiden">
                <img src="/magiboka-logo.webp" alt="Magiboka" className="h-10 md:h-12 w-auto" />
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleTheme}
                  aria-label={theme === 'dark' ? 'Bytt til lyst tema' : 'Bytt til mørkt tema'}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                {account.innlogget ? (
                  <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <span className="font-semibold truncate max-w-[10rem]">Hei{account.fornavn ? `, ${account.fornavn}` : ''}</span>
                    <button
                      onClick={handleLogout}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      aria-label="Logg ut"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="hidden sm:inline">Logg ut</span>
                    </button>
                  </div>
                ) : account.vippsReady ? (
                  <a
                    href="/api/vipps/start"
                    className="inline-flex items-center px-4 py-2 rounded-full bg-[#FF5B24] text-[#1A0B05] font-bold hover:bg-[#FF7445] text-sm md:text-base"
                  >
                    Logg inn med Vipps
                  </a>
                ) : null}
              </div>
            </div>
          </header>
        </div>
      )}

      {/* Floating controls while reading — the only chrome visible once
          the banner and header are hidden. Hjem returns to setup; the
          sun/moon toggles theme without leaving the story. */}
      {isReading && (
        <div className="fixed top-3 left-3 z-40 flex items-center gap-2">
          <button
            onClick={handleRestart}
            aria-label="Til forsiden"
            className="bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 shadow-md backdrop-blur-sm rounded-full p-2 text-gray-700 dark:text-gray-200 transition-colors"
          >
            <img src="/magiboka-logo.webp" alt="Magiboka" className="h-6 w-auto" />
          </button>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Bytt til lyst tema' : 'Bytt til mørkt tema'}
            className="bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 shadow-md backdrop-blur-sm rounded-full p-2 text-gray-700 dark:text-gray-200 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      )}

      <main className={`flex-grow flex items-center justify-center relative ${isReading ? 'p-2 lg:p-4' : 'p-4 md:p-8 items-start'}`}>
        {error && (
           <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded flex items-center shadow-lg">
             <AlertCircle className="w-5 h-5 mr-2" />
             <span>{error}</span>
             <button onClick={() => setError(null)} className="ml-4 font-bold">✕</button>
           </div>
        )}

        {/* Loading Overlay when starting story */}
        {view === 'setup' && isLoading && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                 <div className="w-full max-w-lg h-96 relative bg-[#fdfbf7] rounded-3xl shadow-2xl overflow-hidden transform scale-90 md:scale-100">
                    <PageTurnAnimation />
                 </div>
            </div>
        )}

        {view === 'setup' ? (
          <SetupScreen 
            onStart={handleStartStory} 
            isLoading={isLoading} 
            savedStories={savedStories}
            onLoadStory={handleLoadStory}
            onDeleteStory={handleDeleteStory}
          />
        ) : (
          currentSegment && (
            <BookPage
              segment={currentSegment}
              onChoice={handleChoice}
              onRestart={handleRestart}
              onSave={handleSaveStory}
              onWrapUp={handleWrapUp}
              onNextPage={handleNextPage}
              isGenerating={isLoading}
              isNextPageReady={isNextPageReady}
              pageNumber={currentPageIndex + 1}
              totalPages={estimatedPages}
            />
          )
        )}
      </main>

      <footer className="bg-white/60 border-t border-gray-200 py-4 px-6 text-xs text-gray-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
          <span>Nordgård</span>
          <span className="hidden sm:inline">·</span>
          <span>Org.nr. 937 095 082</span>
          <span className="hidden sm:inline">·</span>
          <a href="mailto:trymnord@gmail.com" className="hover:text-gray-700 underline">trymnord@gmail.com</a>
        </div>
      </footer>
    </div>
  );
};

export default App;
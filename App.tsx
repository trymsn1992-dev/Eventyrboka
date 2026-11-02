import React, { useState, useEffect, useRef } from 'react';
import { SetupScreen } from './components/SetupScreen';
import { BookPage } from './components/BookPage';
import { PageTurnAnimation } from './components/PageTurnAnimation';
import { StoryOptions, StorySegment, Choice, SavedStory, StoryPlan, DURATIONS, TOTAL_PAGES } from './types';
import { planStory, generateCharacterSheet, startNewStoryText, continueStoryText, generateIllustration } from './services/geminiService';
import { saveStoryToDB, getAllStoriesFromDB, deleteStoryFromDB } from './services/storage';
import { AlertCircle, MessageSquare } from 'lucide-react';

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

  // Pending plan while it generates in the background. handleChoice awaits
  // this so segment 2+ get the plan even if the user clicks before it lands.
  const pendingPlanRef = useRef<Promise<StoryPlan | undefined> | null>(null);

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

  // Load stories from IndexedDB on mount
  useEffect(() => {
    const loadStories = async () => {
      try {
        // Migration: Check for stories in localStorage and move them to DB
        const localStoriesJson = localStorage.getItem('eventyrboka_stories');
        if (localStoriesJson) {
          try {
            const localStories = JSON.parse(localStoriesJson) as SavedStory[];
            for (const s of localStories) {
              await saveStoryToDB(s);
            }
            localStorage.removeItem('eventyrboka_stories');
            console.log("Migrated stories from localStorage to IndexedDB");
          } catch (e) {
            console.warn("Failed to migrate local stories", e);
          }
        }

        // Load from DB
        const stories = await getAllStoriesFromDB();
        setSavedStories(stories);
      } catch (e) {
        console.error("Failed to load stories", e);
        setError("Kunne ikke laste lagrede historier.");
      }
    };
    loadStories();
  }, []);

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

  const handleStartStory = async (selectedOptions: StoryOptions) => {
    setOptions(selectedOptions);
    setPlan(null);
    setCurrentPageIndex(0);
    setIsLoading(true);
    setError(null);
    try {
      // Fire plan + sheet in the background. Neither blocks the first segment.
      // The plan is used from segment 2 onward; the sheet is used by every
      // illustration call. Both finish while the reader is on segment 1.
      const planPromise = planStory(selectedOptions).catch(err => {
        console.warn("Plan failed, continuing without plan", err);
        return undefined;
      });
      const sheetPromise = generateCharacterSheet(selectedOptions.character);
      pendingPlanRef.current = planPromise;

      // Start segment 1 immediately. The server-side opener picks an archetype
      // seed itself so the opening stays varied without needing the plan.
      const firstSegment = await startNewStoryText(selectedOptions, undefined);
      setSegments([firstSegment]);
      setView('reading');
      setIsLoading(false);

      // Compose plan + sheet into state as they land, so segment 2+ have both.
      void Promise.all([planPromise, sheetPromise]).then(([p, sheet]) => {
        if (!p && !sheet) return;
        const composed: StoryPlan = {
          logline: p?.logline ?? '',
          characterVoice: p?.characterVoice ?? '',
          beats: p?.beats ?? [],
          moralArc: p?.moralArc ?? '',
          settingSeeds: p?.settingSeeds ?? [],
          sideCharacters: p?.sideCharacters ?? [],
          characterSheetBase64: sheet,
        };
        setPlan(composed);
      });

      // Illustrate segment 1 in the background. It only needs the sheet, not the plan.
      void attachIllustrationAt(0, firstSegment, selectedOptions, undefined, sheetPromise);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg || "Beklager, vi klarte ikke å starte historien. Prøv igjen om et minutt.");
      setIsLoading(false);
    }
  };

  const handleChoice = async (choice: Choice) => {
    if (!options) return;
    setIsLoading(true);
    setError(null);
    try {
      // If the plan is still generating, wait for it before continuing.
      // By the time a reader clicks a choice this is almost always a no-op.
      let activePlan = plan ?? undefined;
      if (!activePlan && pendingPlanRef.current) {
        activePlan = (await pendingPlanRef.current) ?? undefined;
      }
      const nextSegment = await continueStoryText(options, segments, choice.nextPlotPoint, activePlan);
      const insertIndex = segments.length;
      setSegments(prev => [...prev, nextSegment]);
      setIsLoading(false);
      void attachIllustrationAt(
        insertIndex,
        nextSegment,
        options,
        activePlan,
        Promise.resolve(activePlan?.characterSheetBase64)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg || "Oisann! Noe gikk galt når vi skulle bla om. Prøv å klikke igjen.");
      setIsLoading(false);
    }
  };

  // Parent escape hatch: next page becomes the resolution regardless of plan position.
  const handleWrapUp = async () => {
    if (!options) return;
    setIsLoading(true);
    setError(null);
    try {
      let activePlan = plan ?? undefined;
      if (!activePlan && pendingPlanRef.current) {
        activePlan = (await pendingPlanRef.current) ?? undefined;
      }
      const nextSegment = await continueStoryText(
        options,
        segments,
        "avslutt historien varmt nå",
        activePlan,
        true,
      );
      const insertIndex = segments.length;
      setSegments(prev => [...prev, nextSegment]);
      setIsLoading(false);
      void attachIllustrationAt(
        insertIndex,
        nextSegment,
        options,
        activePlan,
        Promise.resolve(activePlan?.characterSheetBase64)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg || "Klarte ikke å avslutte historien akkurat nå. Prøv igjen.");
      setIsLoading(false);
    }
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
      await saveStoryToDB(newStory);
      setSavedStories(prev => [newStory, ...prev]);
      return true;
    } catch (e) {
      console.error("Save error:", e);
      setError("Kunne ikke lagre eventyret. Det kan hende disken er full.");
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
      await deleteStoryFromDB(id);
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

  return (
    <div className="min-h-screen bg-[#e8e6e1] flex flex-col">
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
        <header className="bg-white shadow-sm py-4 px-6">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <button onClick={handleRestart} className="flex items-center cursor-pointer" aria-label="Magiboka — til forsiden">
              <img src="/magiboka-logo.webp" alt="Magiboka" className="h-10 md:h-12 w-auto" />
            </button>
            {view === 'reading' && options && (
              <div className="hidden md:flex text-sm text-gray-500 gap-4">
                <span className="bg-indigo-50 px-3 py-1 rounded-full text-indigo-700">{options.character}</span>
                <span className="bg-amber-50 px-3 py-1 rounded-full text-amber-700">{options.metaphor}</span>
              </div>
            )}
          </div>
        </header>
      </div>

      <main className="flex-grow flex items-start justify-center p-4 md:p-8 relative">
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
    </div>
  );
};

export default App;
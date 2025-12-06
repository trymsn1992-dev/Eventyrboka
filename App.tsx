import React, { useState, useEffect } from 'react';
import { SetupScreen } from './components/SetupScreen';
import { BookPage } from './components/BookPage';
import { PageTurnAnimation } from './components/PageTurnAnimation';
import { StoryOptions, StorySegment, Choice, SavedStory, DURATIONS, DURATION_ESTIMATES } from './types';
import { startNewStory, continueStory } from './services/geminiService';
import { saveStoryToDB, getAllStoriesFromDB, deleteStoryFromDB } from './services/storage';
import { AlertCircle } from 'lucide-react';

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const App: React.FC = () => {
  const [view, setView] = useState<'setup' | 'reading'>('setup');
  const [options, setOptions] = useState<StoryOptions | null>(null);
  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedStories, setSavedStories] = useState<SavedStory[]>([]);

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

  const handleStartStory = async (selectedOptions: StoryOptions) => {
    setOptions(selectedOptions);
    setIsLoading(true);
    setError(null);
    try {
      const firstSegment = await startNewStory(selectedOptions);
      setSegments([firstSegment]);
      setView('reading');
    } catch (err) {
      setError("Beklager, vi klarte ikke å starte historien. Prøv igjen, eller sjekk internettforbindelsen.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleChoice = async (choice: Choice) => {
    setIsLoading(true);
    setError(null);
    try {
      const nextSegment = await continueStory(choice.nextPlotPoint);
      setSegments(prev => [...prev, nextSegment]);
    } catch (err) {
      setError("Oisann! Noe gikk galt når vi skulle bla om. Prøv å klikke igjen.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    setSegments([]);
    setOptions(null);
    setView('setup');
    setError(null);
  };

  const handleSaveStory = async (): Promise<boolean> => {
    if (!options || segments.length === 0) return false;

    const newStory: SavedStory = {
      id: generateId(),
      createdAt: Date.now(),
      options: options,
      segments: segments
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
    setSegments(story.segments);
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

  // Get the current segment (the last one in the array)
  const currentSegment = segments[segments.length - 1];

  // Calculate estimated total pages based on selected duration
  const estimatedPages = options?.duration ? DURATION_ESTIMATES[options.duration] : undefined;

  return (
    <div className="min-h-screen bg-[#e8e6e1] flex flex-col">
      <header className="bg-white shadow-sm py-4 px-6 z-20">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold text-indigo-800 flex items-center gap-2 cursor-pointer" onClick={handleRestart}>
            <span className="text-3xl">📚</span> Eventyrboka
          </h1>
          {view === 'reading' && options && (
            <div className="hidden md:flex text-sm text-gray-500 gap-4">
              <span className="bg-indigo-50 px-3 py-1 rounded-full text-indigo-700">{options.character}</span>
              <span className="bg-amber-50 px-3 py-1 rounded-full text-amber-700">{options.theme}</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center p-4 md:p-8 relative">
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
              isGenerating={isLoading}
              pageNumber={segments.length}
              totalPages={estimatedPages}
            />
          )
        )}
      </main>
    </div>
  );
};

export default App;
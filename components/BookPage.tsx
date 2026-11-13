
import React, { useEffect, useRef, useState } from 'react';
import { Choice, PERSONAL_STORY_NAME, StorySegment } from '../types';
import { Button } from './Button';
import { ArrowDown, ArrowRight, ChevronLeft, RefreshCw, CheckCircle, Sparkles, Save, Home, Volume2, Loader2, StopCircle, Music, Mic, MessageSquare, Star } from 'lucide-react';
import { generateSpeech } from '../services/geminiService';
import { IllustrationLoader } from './IllustrationLoader';
import { logEvent } from '../services/analytics';
import { insightError, insightRated, insightReadAloud } from '../services/insight';
import { ProBadge } from './SetupScreen';

const FEEDBACK_URL = 'https://grinas.typeform.com/to/sFjrTX2j';

const WAIT_QUESTIONS = [
  "Hva ser du i bildet?",
  "Hvor mange farger kan du finne?",
  "Hva tror du skjer videre?",
  "Hvis du var i bildet, hva ville du gjort?",
  "Hvilken lyd tror du du ville hørt her?",
  "Finner du noe skjult i bildet?",
  "Hva ville du sagt hvis du var der?",
  "Hvem i bildet ligner mest på deg?",
  "Hva lukter det kanskje her?",
  "Hva synes du er finest i bildet?",
  "Kan du telle alle tingene i bildet?",
  "Hva ville du gjort først hvis du var med?",
  "Hvilken ting i bildet ville du tatt med hjem?",
  "Hva tror du figurene snakker om?",
];

const WAIT_MESSAGES = [
  "Blar om til neste side...",
  "Pønsker ut hva som skjer...",
  "Tegner neste bilde...",
  "Koker sammen litt magi...",
  "Spisser blyantene...",
  "Fargelegger fantasien...",
  "Hva skjer nå, mon tro?",
  "Skriver så blekket spruter...",
];

interface BookPageProps {
  segment: StorySegment;
  onChoice: (choice: Choice) => void;
  onRestart: () => void;
  onSave: () => Promise<boolean>;
  onWrapUp?: () => void;
  // Label of the choice whose page is still being written. While set, the
  // choices are replaced by a "Neste side blir til…" indicator.
  waitingFor?: string | null;
  // The choice that led to this page, shown as "Du valgte: …" above the text.
  arrivedVia?: string;
  isGenerating: boolean;
  pageNumber: number;
  totalPages?: number; // Total estimated pages
  // Read-aloud is a Pro feature.
  // Read-aloud is part of «Magihistorie» and Prinsen.
  readAloud: boolean;
}

export const BookPage: React.FC<BookPageProps> = ({
  segment,
  onChoice,
  onRestart,
  onSave,
  onWrapUp,
  waitingFor,
  arrivedVia,
  isGenerating,
  pageNumber,
  totalPages,
  readAloud
}) => {
  // Shown when someone on Gratis taps "Les høyt".
  const [showProNote, setShowProNote] = useState(false);
  // Chunked text reveal: the page text is split into one-sentence chunks and
  // shown one at a time in a fixed-height frame on mobile. Keeps text small
  // so the illustration stays prominent and the layout never shifts.
  // (Older saved stories carry a "bridge" sentence per choice; it is no
  // longer shown — the next page now opens with what the choice led to.)
  const activeSource = segment.text;
  const textChunks = React.useMemo(() => {
    return activeSource
      .split('\n')
      .flatMap(p => p.split(/(?<=[.!?…])\s+(?=[A-ZÆØÅ«"'])/))
      .map(s => s.trim())
      .filter(Boolean);
  }, [activeSource]);
  const [chunksRevealed, setChunksRevealed] = useState(1);
  // Desktop readers get the whole paragraph; the sentence-at-a-time frame is
  // for small screens where text has to compete with the illustration.
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);
  // The furthest card reached on this page. Once the last one has been seen
  // the choices stay, also when the reader steps back to re-read.
  const [furthestChunk, setFurthestChunk] = useState(1);
  const currentChunk = Math.min(chunksRevealed, textChunks.length);
  const isLastChunk = currentChunk >= textChunks.length;
  const goToChunk = (n: number) => {
    const target = Math.max(1, Math.min(n, textChunks.length));
    setChunksRevealed(target);
    setFurthestChunk(f => Math.max(f, target));
  };
  const allChunksShown = isDesktop || furthestChunk >= textChunks.length;
  const textContainerRef = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  // A page is its number and text. The segment object itself is replaced when
  // the illustration lands, and that must not reset the page the reader is on.
  const pageKey = `${pageNumber}|${segment.text}`;
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  
  // Audio states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Waiting-state (next-page loading) states
  const [waitQuestion, setWaitQuestion] = useState<string>(WAIT_QUESTIONS[0]);
  const [waitMessage, setWaitMessage] = useState<string>(WAIT_MESSAGES[0]);
  const [waitProgress, setWaitProgress] = useState<number>(0);

  useEffect(() => {
    if (!isGenerating) {
      setWaitProgress(0);
      return;
    }

    // Pick a fresh question + message when generation starts
    setWaitQuestion(WAIT_QUESTIONS[Math.floor(Math.random() * WAIT_QUESTIONS.length)]);
    setWaitMessage(WAIT_MESSAGES[Math.floor(Math.random() * WAIT_MESSAGES.length)]);
    setWaitProgress(0);

    const msgInterval = setInterval(() => {
      setWaitMessage(WAIT_MESSAGES[Math.floor(Math.random() * WAIT_MESSAGES.length)]);
    }, 3500);

    const progInterval = setInterval(() => {
      setWaitProgress(prev => {
        const remaining = 95 - prev;
        const increment = Math.max(0.1, remaining * 0.02 + Math.random() * 0.5);
        return Math.min(95, prev + increment);
      });
    }, 100);

    return () => {
      clearInterval(msgInterval);
      clearInterval(progInterval);
    };
  }, [isGenerating]);

  useEffect(() => {
    // New page: back to the top and the first sentence, and stop any audio.
    // 'instant' also cancels a glide to the previous page's choices.
    textContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, behavior: 'instant' });
    stopAudio();
    setChunksRevealed(1);
    setFurthestChunk(1);
    setShowProNote(false);
    setRating(0);
    setHoverRating(0);
  }, [pageKey]);

  useEffect(() => {
    // The page changed, or its illustration just landed: offer saving again
    // so the saved copy gets the picture too.
    setIsSaved(false);
  }, [segment]);

  useEffect(() => () => stopAudio(), []);

  // On small screens the choices land below the fold once the last sentence
  // is shown, so glide down until they are in view. On desktop the right-hand
  // page is left alone: moving it would push the start of the text out of
  // sight before it has been read.
  const choicesShown = allChunksShown && !segment.isEnding && !waitingFor && !isGenerating;
  useEffect(() => {
    if (!choicesShown || isDesktop) return;
    const timer = window.setTimeout(() => {
      const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
      choicesRef.current?.scrollIntoView({ behavior, block: 'nearest' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [choicesShown, pageKey, isDesktop]);

  // On desktop the choices can sit below the fold of the right-hand page.
  // Watch whether they are in view, so a pointer can show the way down.
  const [choicesInView, setChoicesInView] = useState(true);
  useEffect(() => {
    if (!isDesktop || !choicesShown) return;
    const target = choicesRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setChoicesInView(entry.isIntersecting),
      { root: textContainerRef.current, threshold: 0.15 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [isDesktop, choicesShown, pageKey]);
  const scrollToChoices = () => {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
    choicesRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  // Swipe on the text card: left for the next sentence, right for the previous.
  const touchStartX = useRef<number | null>(null);

  // Timers that turn the text cards in step with the read-aloud.
  const syncTimers = useRef<number[]>([]);
  const clearSyncTimers = () => {
    syncTimers.current.forEach(t => window.clearTimeout(t));
    syncTimers.current = [];
  };

  const stopAudio = () => {
    clearSyncTimers();
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      sourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleSaveClick = async () => {
    setIsSaving(true);
    const success = await onSave();
    setIsSaving(false);
    if (success) {
      setIsSaved(true);
    }
  };

  const handleReadAloud = async () => {
    if (!readAloud) {
      setShowProNote(true);
      logEvent('Lås truffet', { funksjon: 'Les høyt' });
      return;
    }
    if (isPlaying) {
      stopAudio();
      return;
    }

    setIsLoadingAudio(true);
    setAudioProgress(0);
    logEvent('Les høyt');
    insightReadAloud();

    // The API gives no progress, and making the voice takes about a minute:
    // fill the bar to 90 % over roughly that long.
    const progressInterval = setInterval(() => {
      setAudioProgress(prev => Math.min(90, prev + 0.75));
    }, 500);

    try {
      const base64Audio = await generateSpeech(segment.text);
      
      if (!base64Audio) {
        console.error("No audio data returned");
        clearInterval(progressInterval);
        setIsLoadingAudio(false);
        return;
      }

      // Finish progress bar
      clearInterval(progressInterval);
      setAudioProgress(100);

      // Small delay to show 100% before playing
      await new Promise(resolve => setTimeout(resolve, 300));

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current;
      
      // Decode Base64 string to Uint8Array
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert raw PCM (Int16) to AudioBuffer (Float32)
      const dataInt16 = new Int16Array(bytes.buffer);
      const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < dataInt16.length; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
      }

      // Play audio
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      source.onended = () => {
        clearSyncTimers();
        setIsPlaying(false);
        sourceRef.current = null;
      };
      
      sourceRef.current = source;
      source.start(0);
      setIsPlaying(true);

      // Small screens show one sentence at a time: turn the cards as the
      // voice gets to each sentence. The voice reads the whole page in one
      // go, so each sentence's start is estimated from its share of the text
      // (plus a little for the pause after it).
      clearSyncTimers();
      if (!isDesktop && textChunks.length > 1) {
        const weights = textChunks.map(c => c.length + 12);
        const total = weights.reduce((a, b) => a + b, 0);
        let elapsed = 0;
        goToChunk(1);
        textChunks.forEach((_, i) => {
          if (i > 0) {
            const at = (elapsed / total) * buffer.duration * 1000;
            syncTimers.current.push(window.setTimeout(() => goToChunk(i + 1), at));
          }
          elapsed += weights[i];
        });
      }

    } catch (error) {
      console.error("Error playing audio:", error);
      insightError();
    } finally {
      clearInterval(progressInterval);
      setIsLoadingAudio(false);
    }
  };

  const hasImage = !!segment.imageBase64;
  
  // Calculate progress percentage
  const progress = totalPages ? Math.min((pageNumber / totalPages) * 100, 100) : 0;

  return (
    <div className="relative flex flex-col lg:flex-row w-full max-w-6xl lg:h-[90vh] h-auto bg-[#fdfbf7] dark:bg-gray-800 rounded-xl lg:rounded-r-3xl lg:rounded-l-md book-shadow lg:overflow-hidden border-r-4 border-gray-200 dark:border-gray-700">
      
      {/* Book Spine visual - Hidden on Mobile to save space */}
      <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-6 md:w-10 bg-gradient-to-r from-gray-300 via-gray-100 to-[#fdfbf7] dark:from-gray-950 dark:via-gray-900 dark:to-gray-800 z-10 shadow-inner"></div>
      
      {/* Content Container */}
      
        {/* Left Page: Illustration (Top on Mobile) */}
        <div className={`w-full ${isGenerating ? 'lg:w-3/5' : 'lg:w-1/2'} p-4 lg:p-8 lg:ml-10 z-0 flex items-center justify-center bg-opacity-50 relative lg:border-r border-gray-200 dark:border-gray-700 border-dashed lg:page-curl bg-indigo-50/30 dark:bg-indigo-950/20 transition-all duration-500 ease-out`}>
          <div className="w-full h-full flex flex-col items-center justify-center lg:border-4 lg:border-double lg:border-indigo-100 dark:lg:border-indigo-900 lg:rounded-lg lg:p-6 lg:bg-white dark:lg:bg-gray-900 lg:shadow-inner">
             <div className={`relative w-full flex-none lg:flex-1 bg-white dark:bg-gray-900 lg:bg-gray-50 dark:lg:bg-gray-900 rounded-md overflow-hidden flex items-center justify-center shadow-sm lg:shadow-none min-h-[280px] ${isGenerating ? 'h-[70vh] max-h-[70vh]' : 'h-[55vh] max-h-[55vh]'} lg:h-auto lg:max-h-full transition-all duration-500 ease-out`}>
                {/* The loader stays mounted while the image loads so the
                    animation keeps running; it fades out as the image fades in. */}
                <div
                  className={`absolute inset-0 transition-opacity duration-700 ease-out ${hasImage ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                >
                  <IllustrationLoader />
                </div>
                {hasImage && (
                  <img
                    src={segment.imageBase64}
                    alt={segment.illustrationPrompt}
                    className="relative w-full h-full object-contain"
                  />
                )}
             </div>
             <div className="mt-2 lg:mt-4 text-indigo-300 text-xs lg:text-sm font-serif italic text-center">
                Side {pageNumber}
             </div>
          </div>
        </div>

        {/* Right Page: Text and Choices (Bottom on Mobile) */}
        <div className={`w-full ${isGenerating ? 'lg:w-2/5' : 'lg:w-1/2'} bg-[#fdfbf7] dark:bg-gray-800 relative flex flex-col lg:h-full transition-all duration-500 ease-out`}>

          {/* Waiting Panel - only when generating with no choice picked yet
              (legacy fallback; the Neste-side button handles the main case). */}
          {isGenerating && (
            <div className="h-full flex flex-col items-center justify-center px-6 py-8 lg:p-8 text-center min-h-[280px]">
              <div className="w-full max-w-sm bg-white border-2 border-indigo-100 rounded-2xl p-5 lg:p-6 shadow-md mb-5 lg:mb-6">
                <p className="text-[11px] lg:text-xs uppercase tracking-widest text-indigo-400 font-bold mb-3">
                  — Mens dere venter —
                </p>
                <h3 className="text-lg lg:text-2xl font-serif font-bold text-indigo-800 mb-3 leading-snug">
                  {waitQuestion}
                </h3>
                <p className="text-xs lg:text-sm text-gray-500 italic">
                  Se på bildet sammen og snakk om det!
                </p>
              </div>

              <div className="flex items-center gap-2 text-indigo-600 mb-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm lg:text-base font-serif italic">
                  {waitMessage}
                </span>
              </div>

              <div className="w-40 lg:w-48 h-2 bg-gray-200 rounded-full overflow-hidden border border-gray-300/50 shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-indigo-300 via-purple-300 to-indigo-400 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${waitProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Audio Loading Overlay */}
          {isLoadingAudio && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#fdfbf7]/95 backdrop-blur-sm transition-all duration-500">
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-indigo-200 rounded-full animate-ping opacity-25"></div>
                <div className="bg-indigo-100 p-6 rounded-full relative shadow-lg">
                  <Mic className="w-12 h-12 text-indigo-600" />
                </div>
                <Music className="absolute -top-2 -right-4 w-8 h-8 text-purple-500 animate-bounce" style={{ animationDelay: '0s' }} />
                <Music className="absolute top-10 -left-6 w-6 h-6 text-pink-500 animate-bounce" style={{ animationDelay: '0.2s' }} />
                <Music className="absolute -bottom-2 -right-2 w-5 h-5 text-blue-500 animate-bounce" style={{ animationDelay: '0.4s' }} />
              </div>
              
              <h3 className="text-xl font-serif font-bold text-indigo-800 text-center px-4 mb-2">
                Varmer opp stemmen...
              </h3>
              <p className="text-sm text-indigo-400 mb-6 text-center px-6">
                Det tar omtrent ett minutt å lage opplesningen.
              </p>

              <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden relative">
                 <div 
                   className="h-full bg-gradient-to-r from-indigo-400 to-purple-500 transition-all duration-200"
                   style={{ width: `${audioProgress}%` }}
                 />
              </div>
            </div>
          )}
          
          {/* Scrollable content container (hidden while next page is generating) */}
          {!isGenerating && (
          <div className="flex-1 p-6 lg:p-12 lg:overflow-y-auto" ref={textContainerRef}>
            
            <div className="mb-6 lg:mb-10">
              <style>{`
                @keyframes chunkSwap { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
                @keyframes nudgeRight { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(6px); } }
                @keyframes nudgeDown { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(5px); } }
                @media (prefers-reduced-motion: reduce) { .hint-nudge { animation: none !important; } }
              `}</style>
              {isDesktop ? (
                // Desktop: full paragraph, no tap-to-advance, no progress dots.
                <div className="rounded-2xl px-5 py-6 lg:px-7 lg:py-8">
                  {arrivedVia && (
                    <p className="text-[11px] lg:text-xs uppercase tracking-widest text-indigo-400 font-bold mb-3">
                      Du valgte: {arrivedVia}
                    </p>
                  )}
                  <p
                    className="font-serif text-gray-800 dark:text-gray-100 leading-relaxed text-xl lg:text-2xl first-letter:text-5xl lg:first-letter:text-6xl first-letter:font-bold first-letter:text-indigo-600 dark:first-letter:text-indigo-300 first-letter:float-left first-letter:mr-3 first-letter:-mt-2"
                    style={{ whiteSpace: 'pre-line' }}
                  >
                    {activeSource}
                  </p>
                </div>
              ) : (
                <>
                  {/* Mobile: one sentence at a time in a fixed-height card, so
                      the image never shifts. Tapping the card goes on; tapping
                      its left third goes back. Swiping works too. */}
                  <div
                    className={`relative w-full rounded-2xl min-h-[190px] border transition-colors select-none ${
                      textChunks.length > 1
                        ? 'border-amber-100 bg-amber-50/40 dark:border-amber-200/25 dark:bg-amber-200/5'
                        : 'border-transparent'
                    }`}
                    onTouchStart={(e) => {
                      touchStartX.current = e.touches[0]?.clientX ?? null;
                    }}
                    onTouchEnd={(e) => {
                      const start = touchStartX.current;
                      touchStartX.current = null;
                      const end = e.changedTouches[0]?.clientX;
                      if (start === null || end === undefined) return;
                      const dx = end - start;
                      if (Math.abs(dx) < 45) return; // a tap — the buttons handle it
                      e.preventDefault();
                      goToChunk(currentChunk + (dx < 0 ? 1 : -1));
                    }}
                  >
                    <div
                      key={`${pageNumber}-${currentChunk}`}
                      style={{ animation: 'chunkSwap 0.4s ease-out' }}
                      className="w-full min-h-[190px] px-5 pt-6 pb-12 flex flex-col items-center justify-center"
                    >
                      {arrivedVia && currentChunk === 1 && (
                        <p className="text-[11px] uppercase tracking-widest text-indigo-400 font-bold mb-3 text-center">
                          Du valgte: {arrivedVia}
                        </p>
                      )}
                      <p
                        aria-live="polite"
                        className={`font-serif text-gray-800 dark:text-gray-100 leading-relaxed text-xl text-center ${
                          currentChunk === 1
                            ? 'first-letter:text-5xl first-letter:font-bold first-letter:text-indigo-600 dark:first-letter:text-indigo-300 first-letter:float-left first-letter:mr-3 first-letter:-mt-2'
                            : ''
                        }`}
                      >
                        {textChunks[currentChunk - 1]}
                      </p>
                    </div>

                    {textChunks.length > 1 && (
                      <>
                        {/* Tap zones: left third back, the rest forward. */}
                        <button
                          type="button"
                          aria-label="Forrige setning"
                          disabled={currentChunk === 1}
                          onClick={() => goToChunk(currentChunk - 1)}
                          className="absolute inset-y-0 left-0 w-[30%] rounded-l-2xl enabled:active:bg-amber-200/30 dark:enabled:active:bg-amber-200/10 disabled:cursor-default"
                        />
                        <button
                          type="button"
                          aria-label="Neste setning"
                          disabled={isLastChunk}
                          onClick={() => goToChunk(currentChunk + 1)}
                          className="absolute inset-y-0 right-0 w-[70%] rounded-r-2xl enabled:active:bg-amber-200/30 dark:enabled:active:bg-amber-200/10 disabled:cursor-default"
                        />

                        {/* What a tap does, spelled out. */}
                        {currentChunk > 1 && (
                          <span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-0.5 text-xs font-semibold text-amber-800/70 dark:text-amber-200/70">
                            <ChevronLeft className="w-4 h-4" />
                            Tilbake
                          </span>
                        )}
                        {!isLastChunk && (
                          <span className="pointer-events-none absolute bottom-2.5 right-3 flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1.5 text-sm font-bold text-amber-950 shadow-md">
                            {currentChunk === 1 ? 'Trykk for å lese videre' : 'Trykk'}
                            <ArrowRight
                              className="hint-nudge w-4 h-4"
                              style={{ animation: 'nudgeRight 1.1s ease-in-out infinite' }}
                            />
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {/* Progress dots: shows how far through the page we are */}
                  {textChunks.length > 1 && (
                    <div className="flex items-center justify-center gap-1.5 mt-3">
                      {textChunks.map((_, idx) => (
                        <span
                          key={idx}
                          className={`block h-1.5 rounded-full transition-all duration-300 ${
                            idx < currentChunk
                              ? 'w-6 bg-indigo-400'
                              : 'w-3 bg-indigo-100 dark:bg-gray-600'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
              {/* Les høyt sits under the text frame now so it does not compete
                  with the illustration for attention at the top. */}
              <div className="mt-5 flex flex-col items-center gap-2">
                <button
                  onClick={handleReadAloud}
                  disabled={isLoadingAudio || isGenerating}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all shadow-sm ${
                    isPlaying
                      ? 'bg-red-100 text-red-600 hover:bg-red-200'
                      : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                  } ${isLoadingAudio ? 'opacity-70 cursor-wait' : ''}`}
                >
                  {isLoadingAudio ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isPlaying ? (
                    <StopCircle className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                  {isLoadingAudio ? 'Laster lyd...' : isPlaying ? 'Stopp opplesning' : 'Les høyt'}
                  {!readAloud && <ProBadge label={PERSONAL_STORY_NAME} />}
                </button>
                {showProNote && (
                  <p role="status" className="text-xs lg:text-sm text-gray-500 dark:text-gray-400 text-center">
                    Opplesning er med i magihistorier og i Prinsen.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-auto space-y-6 pb-8">
               {segment.isEnding ? (
                <div className="text-center py-10 bg-green-50 rounded-2xl border-2 border-green-200 shadow-sm">
                  <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-10 h-10 text-green-600" />
                  </div>
                  <h3 className="text-2xl lg:text-3xl font-bold text-green-800 mb-3 font-serif">Snipp, snapp, snute!</h3>
                  <p className="text-green-700 mb-8 text-lg">Eventyret er ute.</p>
                  
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Button
                      onClick={handleSaveClick}
                      variant="secondary"
                      className="text-lg px-6 py-3"
                      disabled={isSaved || isSaving}
                    >
                      {isSaved ? (
                        <>
                          <CheckCircle className="inline-block w-5 h-5 mr-2" />
                          Lagret
                        </>
                      ) : isSaving ? (
                        <>
                           <span className="animate-spin mr-2">⏳</span>
                           Lagrer...
                        </>
                      ) : (
                        <>
                          <Save className="inline-block w-5 h-5 mr-2" />
                          Lagre eventyr
                        </>
                      )}
                    </Button>
                    <Button onClick={onRestart} variant="primary" className="text-lg px-6 py-3">
                      <Home className="inline-block w-5 h-5 mr-2" />
                      Hjem
                    </Button>
                  </div>

                  <div className="mt-8 pt-6 border-t border-green-200">
                    <p className="text-green-800 font-serif text-lg mb-4">Hva syntes du om eventyret?</p>
                    <div
                      className="flex justify-center gap-1 mb-4"
                      onMouseLeave={() => setHoverRating(0)}
                      role="radiogroup"
                      aria-label="Vurder eventyret"
                    >
                      {[1, 2, 3, 4, 5].map((star) => {
                        const active = (hoverRating || rating) >= star;
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => {
                              setRating(star);
                              logEvent('Vurdering', { stjerner: star });
                              insightRated(star);
                            }}
                            onMouseEnter={() => setHoverRating(star)}
                            className="p-1 transition-transform hover:scale-110 active:scale-95"
                            aria-label={`${star} av 5 stjerner`}
                            aria-pressed={rating === star}
                          >
                            <Star
                              className={`w-8 h-8 lg:w-10 lg:h-10 transition-colors ${
                                active
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'fill-transparent text-gray-300'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                    {rating > 0 && (
                      <div className="animate-in fade-in duration-300">
                        <p className="text-green-700 text-sm mb-3">
                          Takk! Vil du fortelle oss mer?
                        </p>
                        <a
                          href={FEEDBACK_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border-2 border-indigo-200 text-indigo-700 rounded-full font-semibold hover:bg-indigo-50 hover:border-indigo-400 transition-colors shadow-sm"
                        >
                          <MessageSquare className="w-4 h-4" />
                          Gi mer tilbakemelding
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ) : !allChunksShown ? null : (
                waitingFor ? (
                  // A choice was tapped and its page is still being written.
                  <div className="space-y-3" role="status" aria-live="polite">
                    <p className="text-[11px] lg:text-xs uppercase tracking-widest text-indigo-400 font-bold text-center">
                      Du valgte: {waitingFor}
                    </p>
                    <div className="w-full p-4 lg:p-5 rounded-xl lg:rounded-2xl border-2 bg-white border-indigo-100 text-gray-400 dark:bg-gray-700 dark:border-indigo-900 dark:text-gray-300 cursor-wait">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-lg lg:text-xl font-serif">
                          {waitingFor === 'Avslutt historien' ? 'Siste side blir til…' : 'Neste side blir til…'}
                        </span>
                        <div className="rounded-full p-2 shrink-0 bg-indigo-50 dark:bg-gray-600">
                          <Loader2 className="w-5 h-5 lg:w-6 lg:h-6 text-indigo-400 animate-spin" />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                <div className="space-y-4" ref={choicesRef}>
                  <p className="text-xs lg:text-sm uppercase tracking-widest text-indigo-400 font-bold mb-4 text-center">
                    {/* Page 1's choice is about looks (weather, a colour), not an action. */}
                    — {pageNumber === 1 ? 'Hva velger du?' : 'Hva vil du gjøre?'} —
                  </p>
                  {segment.choices.map((choice, idx) => (
                    <button
                      key={idx}
                      onClick={() => onChoice(choice)}
                      className={`w-full group relative p-4 lg:p-5 bg-white dark:bg-gray-700 border-2 ${
                        segment.chosenIndex === idx
                          ? 'border-indigo-400 dark:border-indigo-400'
                          : 'border-indigo-100 dark:border-indigo-900'
                      } rounded-xl lg:rounded-2xl hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-gray-600 dark:hover:border-indigo-600 hover:shadow-lg transition-all duration-300 text-left group transform hover:-translate-y-1 active:scale-95`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="pr-4">
                          {/* Re-reading a saved story: mark what was picked last time. */}
                          {segment.chosenIndex === idx && (
                            <p className="flex items-center gap-1 mb-1 text-[11px] lg:text-xs uppercase tracking-widest font-bold text-indigo-500 dark:text-indigo-300">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Valgt sist
                            </p>
                          )}
                          <span className="font-bold text-gray-700 group-hover:text-indigo-800 dark:text-gray-100 dark:group-hover:text-white text-lg lg:text-xl font-serif">
                            {choice.text}
                          </span>
                        </div>
                        <div className="bg-indigo-100 rounded-full p-2 group-hover:bg-indigo-200 transition-colors shrink-0">
                          <ArrowRight className="w-5 h-5 lg:w-6 lg:h-6 text-indigo-600 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </button>
                  ))}
                  {onWrapUp && (
                    <div className="pt-4 flex justify-center">
                      <button
                        onClick={onWrapUp}
                        className="text-xs lg:text-sm text-gray-400 hover:text-indigo-600 underline decoration-dotted underline-offset-4 transition-colors"
                        title="For voksne: hopp rett til slutten på neste side"
                      >
                        Avslutt historien på neste side
                      </button>
                    </div>
                  )}
                </div>
                )
              )}
            </div>

            {/* Desktop: the choices are further down this page. Point the way
                until they have scrolled into view. */}
            {isDesktop && choicesShown && !choicesInView && (
              <div className="sticky bottom-2 z-10 flex justify-center pointer-events-none">
                <button
                  type="button"
                  onClick={scrollToChoices}
                  className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-3 text-base font-bold text-white shadow-xl ring-4 ring-[#fdfbf7] dark:ring-gray-800 hover:bg-indigo-700 transition-colors"
                >
                  {pageNumber === 1 ? 'Velg lenger ned' : 'Valgene er lenger ned'}
                  <ArrowDown
                    className="hint-nudge w-5 h-5"
                    style={{ animation: 'nudgeDown 1.1s ease-in-out infinite' }}
                  />
                </button>
              </div>
            )}
          </div>
          )}

          {/* Progress Bar at the very bottom */}
          {totalPages && totalPages > 0 && (
             <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gray-100 dark:bg-gray-700">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-400 to-purple-400 transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                ></div>
             </div>
          )}
        </div>

    </div>
  );
};

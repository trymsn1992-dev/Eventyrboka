
import React, { useEffect, useRef, useState } from 'react';
import { Choice, StorySegment } from '../types';
import { Button } from './Button';
import { ArrowRight, RefreshCw, CheckCircle, Image as ImageIcon, Sparkles, Save, Home, Volume2, Loader2, StopCircle, Music, Mic } from 'lucide-react';
import { generateSpeech } from '../services/geminiService';
import { PageTurnAnimation } from './PageTurnAnimation';

interface BookPageProps {
  segment: StorySegment;
  onChoice: (choice: Choice) => void;
  onRestart: () => void;
  onSave: () => Promise<boolean>;
  isGenerating: boolean;
  pageNumber: number;
  totalPages?: number; // Total estimated pages
}

export const BookPage: React.FC<BookPageProps> = ({ 
  segment, 
  onChoice, 
  onRestart, 
  onSave,
  isGenerating,
  pageNumber,
  totalPages
}) => {
  const textContainerRef = useRef<HTMLDivElement>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Audio states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    // Reset scroll on desktop text container or window on mobile
    if (textContainerRef.current) {
      textContainerRef.current.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    
    // Stop audio when turning pages
    stopAudio();
  }, [segment]);

  useEffect(() => {
    // Reset saved state when segment changes
    setIsSaved(false);
    return () => {
      stopAudio();
    }
  }, [segment]);

  const stopAudio = () => {
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
    if (isPlaying) {
      stopAudio();
      return;
    }

    setIsLoadingAudio(true);
    setAudioProgress(0);

    // Simulate progress bar since API doesn't return progress
    const progressInterval = setInterval(() => {
      setAudioProgress(prev => {
        // Slow down as we get closer to 90%
        if (prev >= 90) return 90;
        const increment = Math.max(1, (90 - prev) / 10);
        return prev + increment;
      });
    }, 200);

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
        setIsPlaying(false);
        sourceRef.current = null;
      };
      
      sourceRef.current = source;
      source.start(0);
      setIsPlaying(true);

    } catch (error) {
      console.error("Error playing audio:", error);
    } finally {
      clearInterval(progressInterval);
      setIsLoadingAudio(false);
    }
  };

  const hasImage = !!segment.imageBase64;
  
  // Calculate progress percentage
  const progress = totalPages ? Math.min((pageNumber / totalPages) * 100, 100) : 0;

  return (
    <div className="relative flex flex-col lg:flex-row w-full max-w-6xl lg:h-[90vh] h-auto bg-[#fdfbf7] rounded-xl lg:rounded-r-3xl lg:rounded-l-md book-shadow lg:overflow-hidden border-r-4 border-gray-200">
      
      {/* Book Spine visual - Hidden on Mobile to save space */}
      <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-6 md:w-10 bg-gradient-to-r from-gray-300 via-gray-100 to-[#fdfbf7] z-10 shadow-inner"></div>
      
      {/* Content Container */}
      
        {/* Left Page: Illustration (Top on Mobile) */}
        <div className="w-full lg:w-1/2 p-4 lg:p-8 lg:ml-10 z-0 flex items-center justify-center bg-opacity-50 relative lg:border-r border-gray-200 border-dashed lg:page-curl bg-indigo-50/30">
          <div className="w-full h-full flex flex-col items-center justify-center lg:border-4 lg:border-double lg:border-indigo-100 lg:rounded-lg lg:p-6 lg:bg-white lg:shadow-inner">
             <div className="relative w-full flex-1 bg-white lg:bg-gray-50 rounded-md overflow-hidden flex items-center justify-center shadow-sm lg:shadow-none min-h-[250px] max-h-[40vh] lg:max-h-full">
                {hasImage ? (
                  <img 
                    src={segment.imageBase64} 
                    alt={segment.illustrationPrompt} 
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-gray-300 flex flex-col items-center py-12">
                    <ImageIcon className="w-16 h-16 mb-2" />
                    <span className="text-sm">Illustrasjon mangler</span>
                  </div>
                )}
                
                {/* Overlay caption */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white p-4 pt-8 opacity-0 hover:opacity-100 transition-opacity duration-300">
                    <p className="text-xs md:text-sm font-medium text-center leading-snug">
                      {segment.illustrationPrompt}
                    </p>
                </div>
             </div>
             <div className="mt-2 lg:mt-4 text-indigo-300 text-xs lg:text-sm font-serif italic text-center">
                Side {pageNumber}
             </div>
          </div>
        </div>

        {/* Right Page: Text and Choices (Bottom on Mobile) */}
        <div className="w-full lg:w-1/2 bg-[#fdfbf7] relative flex flex-col lg:h-full">
          
          {/* Loading Overlay with Page Turn Animation */}
          {isGenerating && <PageTurnAnimation />}

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
              <p className="text-sm text-indigo-400 mb-6">Henter frem fortellerstemmen</p>

              <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden relative">
                 <div 
                   className="h-full bg-gradient-to-r from-indigo-400 to-purple-500 transition-all duration-200"
                   style={{ width: `${audioProgress}%` }}
                 />
              </div>
            </div>
          )}
          
          {/* Scrollable content container */}
          <div className="flex-1 p-6 lg:p-12 lg:overflow-y-auto scroll-smooth" ref={textContainerRef}>
            
            {/* Sticky Audio Button Header */}
            <div className="sticky top-0 z-20 flex justify-end mb-4 bg-[#fdfbf7]/95 backdrop-blur-sm py-2 -mt-2 border-b border-indigo-50 lg:border-none lg:bg-transparent lg:backdrop-blur-none">
               <button 
                 onClick={handleReadAloud}
                 disabled={isLoadingAudio || isGenerating}
                 className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all shadow-sm lg:shadow-none
                   ${isPlaying 
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
               </button>
            </div>

            <div className="prose prose-lg lg:prose-xl prose-indigo max-w-none mb-12">
              <div className="font-serif text-gray-800 leading-relaxed space-y-4">
                {segment.text.split('\n').map((paragraph, idx) => (
                  <p key={idx} className={idx === 0 ? "first-letter:text-5xl lg:first-letter:text-6xl first-letter:font-bold first-letter:text-indigo-600 first-letter:float-left first-letter:mr-3 first-letter:-mt-2" : ""}>
                    {paragraph}
                  </p>
                ))}
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
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs lg:text-sm uppercase tracking-widest text-indigo-400 font-bold mb-4 text-center">
                    — Hva vil du gjøre? —
                  </p>
                  {segment.choices.map((choice, idx) => (
                    <button
                      key={idx}
                      onClick={() => onChoice(choice)}
                      className="w-full group relative p-4 lg:p-5 bg-white border-2 border-indigo-100 rounded-xl lg:rounded-2xl hover:border-indigo-500 hover:bg-indigo-50 hover:shadow-lg transition-all duration-300 text-left group transform hover:-translate-y-1 active:scale-95"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700 group-hover:text-indigo-800 text-lg lg:text-xl font-serif pr-4">
                          {choice.text}
                        </span>
                        <div className="bg-indigo-100 rounded-full p-2 group-hover:bg-indigo-200 transition-colors shrink-0">
                          <ArrowRight className="w-5 h-5 lg:w-6 lg:h-6 text-indigo-600 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar at the very bottom */}
          {totalPages && totalPages > 0 && (
             <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gray-100">
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

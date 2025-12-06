import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

export const PageTurnAnimation = () => {
  const messages = [
    "Blar om til neste side...",
    "Pønsker ut hva som skjer...",
    "Tegner katten...",
    "Koker sammen litt magi...",
    "Spisser blyantene...",
    "Fargelegger fantasien...",
    "Hva skjer nå, mon tro?",
    "Skriver så blekket spruter..."
  ];

  const [message, setMessage] = useState(messages[0]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Message rotation - Slower rotation
    const msgInterval = setInterval(() => {
      setMessage(messages[Math.floor(Math.random() * messages.length)]);
    }, 3500);

    // Simulated progress bar logic
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        const remaining = 95 - prev;
        const increment = Math.max(0.1, remaining * 0.02 + Math.random() * 0.5);
        return Math.min(95, prev + increment);
      });
    }, 100);
    
    return () => {
      clearInterval(msgInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#fdfbf7]/95 backdrop-blur-sm rounded-xl transition-all duration-500">
      <div className="relative w-32 h-40 perspective-1000 mb-8 animate-float">
        {/* Book Cover (Back part visible on left) */}
        <div className="absolute inset-0 bg-indigo-800 rounded-r-lg rounded-l-sm shadow-2xl transform translate-z-[-2px]"></div>
        <div className="absolute inset-y-2 left-0 w-4 bg-indigo-900 rounded-l-sm shadow-lg"></div>
        
        {/* Static Pages (Right Stack) - What is revealed under the flip */}
        <div className="absolute inset-y-2 left-4 right-2 bg-white rounded-r-md shadow-sm border-r-2 border-gray-200"></div>
        <div className="absolute inset-y-2 left-4 right-2 bg-gray-50 rounded-r-md shadow-inner border-r border-gray-100 transform translate-x-[1px] translate-y-[1px]"></div>

        {/* Static Pages (Left Stack) - Where the page lands */}
        <div className="absolute inset-y-2 left-4 w-[calc(100%-1.5rem)] bg-white rounded-l-md shadow-sm border-l border-gray-200 transform origin-left rotate-y-180 opacity-0 animate-[fadeIn_3s_infinite]"></div>
        
        {/* Flipping Page */}
        <div className="absolute inset-y-2 left-4 w-[calc(100%-1.5rem)] bg-white rounded-r-md origin-left animate-page-flip transform-style-3d shadow-md border-r border-gray-100 flex items-center justify-center overflow-hidden">
           <div className="w-full h-full bg-gradient-to-r from-gray-50 via-white to-gray-50 opacity-80"></div>
           {/* Content hint on page */}
           <div className="absolute inset-4 space-y-2 opacity-20">
              <div className="h-1 w-3/4 bg-gray-800 rounded"></div>
              <div className="h-1 w-full bg-gray-800 rounded"></div>
              <div className="h-1 w-5/6 bg-gray-800 rounded"></div>
           </div>
           <Sparkles className="absolute text-indigo-400 w-6 h-6 opacity-60" />
        </div>
      </div>
      
      <h3 className="text-xl md:text-2xl font-serif font-bold text-indigo-800 text-center px-4 mb-6 drop-shadow-sm">
        {message}
      </h3>

      {/* Loading Progress Bar */}
      <div className="w-48 md:w-64 h-3 bg-gray-200 rounded-full overflow-hidden border border-gray-300/50 shadow-inner relative">
        <div 
            className="h-full bg-gradient-to-r from-indigo-300 via-purple-300 to-indigo-400 rounded-full transition-all duration-300 ease-out" 
            style={{ width: `${progress}%` }}
        >
          <div className="h-full w-full bg-[linear-gradient(45deg,rgba(255,255,255,.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.2)_50%,rgba(255,255,255,.2)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progress-stripe_2s_linear_infinite]"></div>
        </div>
      </div>
      <p className="text-xs text-indigo-400 mt-3 font-medium tracking-wider uppercase">Vent litt...</p>
    </div>
  );
};
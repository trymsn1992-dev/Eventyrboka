import React from 'react';

// Watercolor-sketch "being drawn" placeholder.
//
// Gemini's image API doesn't stream partial renders, so we can't show the real
// drawing in progress. Instead we fake the feeling: soft blooming watercolor
// washes drift across the page while a pencil traces faint sketch strokes.
// This reads as "the illustrator is at work" rather than "asset missing", and
// lets a reader move on to the next page without waiting for the image.
export const IllustrationLoader: React.FC = () => (
  <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-[#fdfbf7]">
    <style>{`
      @keyframes magiboka-bloom {
        0%, 100% { transform: scale(0.6); opacity: 0; }
        20% { opacity: 0.55; }
        50% { transform: scale(1.15); opacity: 0.75; }
        80% { opacity: 0.35; }
      }
      @keyframes magiboka-stroke {
        0% { stroke-dashoffset: 220; opacity: 0; }
        15% { opacity: 0.85; }
        70% { stroke-dashoffset: 0; opacity: 0.85; }
        90% { opacity: 0.0; }
        100% { stroke-dashoffset: 0; opacity: 0; }
      }
      @keyframes magiboka-pencil {
        0%   { transform: translate(20%, 30%) rotate(-20deg); }
        25%  { transform: translate(60%, 20%) rotate(10deg); }
        50%  { transform: translate(75%, 55%) rotate(-5deg); }
        75%  { transform: translate(35%, 70%) rotate(15deg); }
        100% { transform: translate(20%, 30%) rotate(-20deg); }
      }
      @keyframes magiboka-pulse {
        0%, 100% { opacity: 0.55; }
        50%      { opacity: 1; }
      }
      .magiboka-bloom { animation: magiboka-bloom 4.5s ease-in-out infinite; }
      .magiboka-stroke {
        stroke-dasharray: 220;
        stroke-dashoffset: 220;
        animation: magiboka-stroke 3.8s ease-in-out infinite;
      }
      .magiboka-pencil { animation: magiboka-pencil 8s ease-in-out infinite; }
      .magiboka-pulse  { animation: magiboka-pulse 2.2s ease-in-out infinite; }
    `}</style>

    {/* Soft paper grain */}
    <div
      className="absolute inset-0 opacity-30"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(180,160,130,0.25) 1px, transparent 0)',
        backgroundSize: '18px 18px',
      }}
    />

    {/* Watercolor blooms — staggered so they feel like paint spreading */}
    <div
      className="absolute w-40 h-40 rounded-full blur-3xl magiboka-bloom"
      style={{ top: '18%', left: '22%', background: 'rgba(252,211,170,0.65)', animationDelay: '0s' }}
    />
    <div
      className="absolute w-56 h-56 rounded-full blur-3xl magiboka-bloom"
      style={{ top: '45%', left: '45%', background: 'rgba(249,183,183,0.55)', animationDelay: '1.2s' }}
    />
    <div
      className="absolute w-36 h-36 rounded-full blur-3xl magiboka-bloom"
      style={{ top: '30%', left: '65%', background: 'rgba(190,200,245,0.60)', animationDelay: '2.4s' }}
    />
    <div
      className="absolute w-44 h-44 rounded-full blur-3xl magiboka-bloom"
      style={{ top: '60%', left: '20%', background: 'rgba(200,230,200,0.55)', animationDelay: '3.0s' }}
    />

    {/* Sketch strokes — each stroke "draws" then fades, in sequence */}
    <svg
      viewBox="0 0 200 200"
      className="relative w-4/5 h-4/5"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g stroke="#8a7968" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <path d="M 50 120 C 60 90, 90 75, 120 85" className="magiboka-stroke" style={{ animationDelay: '0s' }} />
        <path d="M 70 110 Q 100 70, 140 95" className="magiboka-stroke" style={{ animationDelay: '0.6s' }} />
        <path d="M 55 135 C 80 150, 120 150, 150 130" className="magiboka-stroke" style={{ animationDelay: '1.2s' }} />
        <path d="M 90 95 Q 110 110, 125 100" className="magiboka-stroke" style={{ animationDelay: '1.8s' }} />
        <path d="M 60 145 L 140 145" className="magiboka-stroke" style={{ animationDelay: '2.4s' }} />
      </g>
      {/* Pencil cursor roaming the page */}
      <g className="magiboka-pencil" style={{ transformOrigin: 'center' }}>
        <g transform="translate(0,0) rotate(0)">
          <line x1="0" y1="0" x2="10" y2="10" stroke="#5b4a3f" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="10" r="1.4" fill="#5b4a3f" />
        </g>
      </g>
    </svg>

    {/* Caption */}
    <div className="absolute bottom-5 left-0 right-0 text-center pointer-events-none">
      <p className="text-sm text-indigo-500/80 font-serif italic magiboka-pulse">
        Tegner bildet…
      </p>
    </div>
  </div>
);

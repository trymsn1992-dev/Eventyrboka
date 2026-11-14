import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { SavedStory } from '../types';
import { logEvent } from '../services/analytics';

// Printing a saved story as a little book. The reader picks a format, the
// pages are laid out on A4 sheets in a hidden container (#print-root), and
// the browser's own print window does the rest. On screen the container is
// parked far off to the left; in print it is the only thing on the page.

export type PrintFormat = 'staaende' | 'liggende' | 'hefte' | 'minibok';

// The minibook has room for six story pages, and its pages are tiny.
const MINIBOOK_MAX_PAGES = 6;
const MINIBOOK_MAX_CHARS = 700;

interface FormatInfo {
  id: PrintFormat;
  name: string;
  about: string;
  landscape: boolean;
  steps: string[];
}

const FORMATS: FormatInfo[] = [
  {
    id: 'staaende',
    name: 'Stående bok',
    about: 'Ett ark per side, med bildet over teksten. Lag hull i kanten og knyt sammen.',
    landscape: false,
    steps: [
      'Skriv ut på A4, stående, på én side av arket.',
      'Lag hull der ringene er i venstre kant.',
      'Knyt arkene sammen med hyssing eller sløyfebånd.',
    ],
  },
  {
    id: 'liggende',
    name: 'Liggende bildebok',
    about: 'Bildet til venstre og teksten til høyre, som boka på skjermen.',
    landscape: true,
    steps: [
      'Skriv ut på A4, liggende, på én side av arket.',
      'Lag hull der ringene er i venstre kant.',
      'Knyt arkene sammen med hyssing eller sløyfebånd.',
    ],
  },
  {
    id: 'hefte',
    name: 'Brettet hefte',
    about: 'Arkene brettes på midten til et lite hefte, som et pass.',
    landscape: true,
    steps: [
      'Skriv ut på A4, liggende og tosidig. Velg «vend på kortsiden».',
      'Legg arkene oppå hverandre i rekkefølgen de kom ut, med forsiden ytterst.',
      'Brett bunken på midten, og stift eller sy i bretten.',
    ],
  },
  {
    id: 'minibok',
    name: 'Minibok av ett ark',
    about: 'Hele eventyret på ett ark, som brettes og klippes til en bitte liten bok.',
    landscape: true,
    steps: [
      'Skriv ut på A4, liggende, på én side av arket.',
      'Brett arket i åtte, og klipp langs den stiplede linja midt på.',
      'Brett arket på langs og skyv endene mot hverandre, så blir det en bok.',
    ],
  },
];

type Page =
  | { kind: 'cover' }
  | { kind: 'owner' }
  | { kind: 'title' }
  | { kind: 'pic'; i: number }
  | { kind: 'text'; i: number }
  | { kind: 'both'; i: number }
  | { kind: 'moral' }
  | { kind: 'draw' }
  | { kind: 'back'; moral: boolean };

// One page placed on a sheet, in millimetres. `flip` turns it upside down.
interface Slot {
  page: Page;
  x: number;
  y: number;
  w: number;
  h: number;
  flip?: boolean;
  no?: number;
}

interface Sheet {
  slots: Slot[];
  holes?: boolean;
  marks?: 'fold' | 'mini';
}

const A4_LONG = 297;
const A4_SHORT = 210;

function buildSheets(format: PrintFormat, count: number): Sheet[] {
  const story = Array.from({ length: count }, (_, i) => i);

  if (format === 'staaende' || format === 'liggende') {
    const w = format === 'staaende' ? A4_SHORT : A4_LONG;
    const h = format === 'staaende' ? A4_LONG : A4_SHORT;
    const pages: Page[] = [
      { kind: 'cover' },
      ...story.map((i): Page => ({ kind: 'both', i })),
      { kind: 'back', moral: true },
    ];
    return pages.map((page) => ({
      holes: true,
      slots: [{ page, x: 0, y: 0, w, h, no: page.kind === 'both' ? page.i + 1 : undefined }],
    }));
  }

  if (format === 'hefte') {
    // Every story page is a spread: picture on the left, text on the right.
    // The page count must divide by four, so an even number of story pages
    // gets two extra pages at the front.
    const pages: Page[] = [{ kind: 'cover' }];
    if (count % 2 === 0) pages.push({ kind: 'owner' }, { kind: 'title' });
    story.forEach((i) => pages.push({ kind: 'pic', i }, { kind: 'text', i }));
    pages.push({ kind: 'back', moral: true });
    const n = pages.length;
    const half = A4_LONG / 2;
    const slot = (index: number, right: boolean): Slot => ({
      page: pages[index],
      x: right ? half : 0,
      y: 0,
      w: half,
      h: A4_SHORT,
      no: pages[index].kind === 'text' || pages[index].kind === 'pic' ? index + 1 : undefined,
    });
    const sheets: Sheet[] = [];
    for (let s = 0; s < n / 4; s++) {
      sheets.push({ marks: 'fold', slots: [slot(n - 1 - 2 * s, false), slot(2 * s, true)] });
      sheets.push({ slots: [slot(2 * s + 1, false), slot(n - 2 - 2 * s, true)] });
    }
    return sheets;
  }

  // Minibook: eight pages on one side of one sheet. The top row is upside
  // down, so everything is the right way up once the sheet is folded.
  const pages: Page[] = [{ kind: 'cover' }, ...story.map((i): Page => ({ kind: 'both', i }))];
  const hasMoralPage = pages.length < 7;
  if (hasMoralPage) pages.push({ kind: 'moral' });
  while (pages.length < 7) pages.push({ kind: 'draw' });
  pages.push({ kind: 'back', moral: !hasMoralPage });
  const w = A4_LONG / 4;
  const h = A4_SHORT / 2;
  const top = [5, 4, 3, 2];
  const bottom = [6, 7, 8, 1];
  return [
    {
      marks: 'mini',
      slots: [
        ...top.map((p, col): Slot => ({ page: pages[p - 1], x: col * w, y: 0, w, h, flip: true })),
        ...bottom.map((p, col): Slot => ({ page: pages[p - 1], x: col * w, y: h, w, h })),
      ],
    },
  ];
}

// Type sizes and margins for the pages of each format.
const PAGE_VARS: Record<PrintFormat, React.CSSProperties> = {
  staaende: {
    '--pad': '16mm 16mm 14mm 30mm', '--title': '34pt', '--kicker': '15pt', '--small': '10pt',
    '--gap': '8mm', '--img': '55%', '--radius': '4mm',
  } as React.CSSProperties,
  liggende: {
    '--pad': '16mm 16mm 14mm 30mm', '--title': '34pt', '--kicker': '15pt', '--small': '10pt',
    '--gap': '10mm', '--img': '46%', '--radius': '4mm',
  } as React.CSSProperties,
  hefte: {
    '--pad': '13mm', '--title': '25pt', '--kicker': '12pt', '--small': '8.5pt',
    '--gap': '6mm', '--img': '50%', '--radius': '3mm',
  } as React.CSSProperties,
  minibok: {
    '--pad': '6.5mm', '--title': '13pt', '--kicker': '7pt', '--small': '5.5pt',
    '--gap': '2.5mm', '--img': '42%', '--radius': '1.5mm',
  } as React.CSSProperties,
};

// Largest and smallest text size (pt) for the story text; it is shrunk
// until it fits its box.
const TEXT_SIZE: Record<PrintFormat, [number, number]> = {
  staaende: [17, 9],
  liggende: [17, 9],
  hefte: [15, 8],
  minibok: [9, 5.5],
};

const PRINT_CSS = `
#print-root { position: fixed; left: -99999px; top: 0; color: #1f2937; font-family: 'Lora', Georgia, serif; }
#print-root * { box-sizing: border-box; }
#print-root .ps {
  position: relative; overflow: hidden; background: #fff;
  break-after: page; page-break-after: always; break-inside: avoid;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
#print-root .ps:last-child { break-after: auto; page-break-after: auto; }
#print-root .pg { position: absolute; display: flex; flex-direction: column; overflow: hidden; padding: var(--pad); }
#print-root .pg-flip { transform: rotate(180deg); }
#print-root .imgbox { position: relative; flex: 1 1 0; min-height: 0; min-width: 0; }
#print-root .imgbox img {
  position: absolute; inset: 0; margin: auto; max-width: 100%; max-height: 100%;
  border-radius: var(--radius);
}
#print-root .fit { flex: 1 1 0; min-height: 0; min-width: 0; display: flex; align-items: center; overflow: hidden; }
#print-root .fit-in { width: 100%; }
#print-root .fit p { margin: 0 0 0.65em; line-height: 1.45; }
#print-root .fit p:last-child { margin-bottom: 0; }
#print-root .no { flex: none; padding-top: 1.5mm; text-align: center; font-size: var(--small); color: #9ca3af; }
#print-root .both { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: var(--gap); }
#print-root .both .imgbox { flex: 0 0 var(--img); }
#print-root .both-row { flex-direction: row; }
#print-root .center { align-items: center; justify-content: center; text-align: center; }
#print-root .kicker { font-family: 'Quicksand', sans-serif; font-weight: 700; font-size: var(--kicker); color: #4f46e5; letter-spacing: 0.04em; }
#print-root .title { font-weight: 700; font-size: var(--title); line-height: 1.15; margin: 0.15em 0 0.5em; overflow-wrap: anywhere; }
#print-root .small { font-family: 'Quicksand', sans-serif; font-size: var(--small); color: #6b7280; }
#print-root .moral { font-style: italic; font-size: calc(var(--kicker) * 1.25); line-height: 1.35; margin: 0.4em 0 1.2em; }
#print-root .line { width: 70%; border-bottom: 0.3mm solid #9ca3af; margin: 2.2em auto 0; }
#print-root .frame { flex: 1 1 0; align-self: stretch; margin-top: var(--gap); border: 0.4mm dashed #c7c9d1; border-radius: var(--radius); }
#print-root .logo { width: 45%; max-height: 22%; object-fit: contain; margin-bottom: 1em; }
#print-root .hole { position: absolute; left: 9mm; width: 6mm; height: 6mm; margin-top: -3mm; border: 0.3mm dashed #b6b8c2; border-radius: 50%; }
#print-root .mark { position: absolute; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  body > *:not(#print-root) { display: none !important; }
  #print-root { position: static; }
}
`;

const paragraphs = (text: string): string[] =>
  text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

interface PrintPagesProps {
  story: SavedStory;
  format: PrintFormat;
}

// The sheets of one format, exactly as they are printed.
const PrintPages: React.FC<PrintPagesProps> = ({ story, format }) => {
  const landscape = format !== 'staaende';
  // A hair short of the paper, so a rounding error never spills onto an empty sheet.
  const sheetW = landscape ? A4_LONG : A4_SHORT;
  const sheetH = (landscape ? A4_SHORT : A4_LONG) - 0.4;
  const sheets = useMemo(() => buildSheets(format, story.segments.length), [format, story.segments.length]);
  const hero = story.options.character;
  const moral = story.options.metaphor;
  const cover = story.segments.find((s) => s.imageBase64)?.imageBase64;
  const date = new Date(story.createdAt).toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const [maxPt, minPt] = TEXT_SIZE[format];

  const picture = (i: number) => {
    const src = story.segments[i]?.imageBase64;
    return <div className="imgbox">{src && <img src={src} alt="" />}</div>;
  };
  const text = (i: number) => (
    <div className="fit" data-fit data-max={maxPt} data-min={minPt}>
      <div className="fit-in">
        {paragraphs(story.segments[i]?.text ?? '').map((p, k) => (
          <p key={k}>{p}</p>
        ))}
      </div>
    </div>
  );

  const content = (slot: Slot): React.ReactNode => {
    const page = slot.page;
    const number = slot.no ? <div className="no">{slot.no}</div> : null;
    switch (page.kind) {
      case 'cover':
        return (
          <>
            <div className="kicker" style={{ textAlign: 'center' }}>Eventyret om</div>
            <div className="title" style={{ textAlign: 'center' }}>{hero}</div>
            <div className="imgbox">{cover && <img src={cover} alt="" />}</div>
            <div className="small" style={{ textAlign: 'center', paddingTop: '0.8em' }}>
              Et eventyr fra Magiboka
            </div>
          </>
        );
      case 'owner':
        return (
          <>
            <div className="kicker">Denne boka tilhører</div>
            <div className="line" />
          </>
        );
      case 'title':
        return (
          <>
            <div className="kicker">Eventyret om</div>
            <div className="title">{hero}</div>
            <div className="small">{date}</div>
          </>
        );
      case 'pic':
        return (
          <>
            {picture(page.i)}
            {number}
          </>
        );
      case 'text':
        return (
          <>
            {text(page.i)}
            {number}
          </>
        );
      case 'both':
        return (
          <>
            <div className={`both ${format === 'liggende' ? 'both-row' : ''}`}>
              {picture(page.i)}
              {text(page.i)}
            </div>
            {number}
          </>
        );
      case 'moral':
        return (
          <>
            <div className="kicker">Lærepengen</div>
            <div className="moral">{moral}</div>
          </>
        );
      case 'draw':
        return (
          <>
            <div className="kicker">Tegn din egen side</div>
            <div className="frame" />
          </>
        );
      case 'back':
        return (
          <>
            <img className="logo" src="/magiboka-logo.webp" alt="" />
            {page.moral && (
              <>
                <div className="kicker">Lærepengen</div>
                <div className="moral">{moral}</div>
              </>
            )}
            <div className="small">Laget med Magiboka · magiboka.no</div>
            <div className="small">{date}</div>
          </>
        );
    }
  };

  const centered = (page: Page) =>
    page.kind === 'owner' || page.kind === 'title' || page.kind === 'moral' || page.kind === 'back' || page.kind === 'draw';

  return (
    <>
      {sheets.map((sheet, s) => (
        <div key={s} className="ps" style={{ width: `${sheetW}mm`, height: `${sheetH}mm` }}>
          {sheet.slots.map((slot, k) => (
            <div
              key={k}
              className={`pg ${slot.flip ? 'pg-flip' : ''} ${centered(slot.page) ? 'center' : ''}`}
              style={{
                ...PAGE_VARS[format],
                left: `${slot.x}mm`,
                top: `${slot.y}mm`,
                width: `${slot.w}mm`,
                height: `${Math.min(slot.h, sheetH - slot.y)}mm`,
              }}
            >
              {content(slot)}
            </div>
          ))}
          {sheet.holes && (
            <>
              <div className="hole" style={{ top: `${sheetH / 2 - 40}mm` }} />
              <div className="hole" style={{ top: `${sheetH / 2 + 40}mm` }} />
            </>
          )}
          {sheet.marks === 'fold' && (
            <>
              <div className="mark" style={{ left: `${sheetW / 2}mm`, top: 0, height: '5mm', borderLeft: '0.2mm solid #c7c9d1' }} />
              <div className="mark" style={{ left: `${sheetW / 2}mm`, bottom: 0, height: '5mm', borderLeft: '0.2mm solid #c7c9d1' }} />
            </>
          )}
          {sheet.marks === 'mini' && (
            <>
              {[1, 2, 3].map((col) => (
                <div
                  key={col}
                  className="mark"
                  style={{ left: `${(sheetW / 4) * col}mm`, top: 0, bottom: 0, borderLeft: '0.2mm dotted #d1d5db' }}
                />
              ))}
              <div className="mark" style={{ left: 0, right: 0, top: `${A4_SHORT / 2}mm`, borderTop: '0.2mm dotted #d1d5db' }} />
              <div
                className="mark"
                style={{ left: `${sheetW / 4}mm`, width: `${sheetW / 2}mm`, top: `${A4_SHORT / 2}mm`, borderTop: '0.4mm dashed #4b5563' }}
              />
              <div
                className="mark small"
                style={{ left: `${sheetW / 4 + 1.5}mm`, top: `${A4_SHORT / 2 - 4.2}mm`, fontSize: '8pt', color: '#4b5563' }}
              >
                ✂ klipp her
              </div>
            </>
          )}
        </div>
      ))}
    </>
  );
};

// Shrink the story text on every page until it fits its box.
function fitText(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-fit]').forEach((box) => {
    const inner = box.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const min = Number(box.dataset.min) || 6;
    let size = Number(box.dataset.max) || 14;
    box.style.fontSize = `${size}pt`;
    while (size > min && inner.offsetHeight > box.clientHeight) {
      size -= 0.25;
      box.style.fontSize = `${size}pt`;
    }
  });
}

// A little drawing of each format for its card.
const FormatIcon: React.FC<{ id: PrintFormat }> = ({ id }) => {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg viewBox="0 0 48 40" className="w-14 h-12 shrink-0" aria-hidden="true">
      {id === 'staaende' && (
        <g {...common}>
          <rect x="13" y="3" width="24" height="34" rx="2" />
          <circle cx="17.5" cy="13" r="1.3" />
          <circle cx="17.5" cy="27" r="1.3" />
          <path d="M17.5 13 C9 13 9 27 17.5 27" />
          <rect x="22" y="8" width="11" height="12" rx="1" />
          <path d="M22 25h11M22 29h11M22 33h7" />
        </g>
      )}
      {id === 'liggende' && (
        <g {...common}>
          <rect x="5" y="7" width="38" height="26" rx="2" />
          <circle cx="9.5" cy="14" r="1.3" />
          <circle cx="9.5" cy="26" r="1.3" />
          <path d="M9.5 14 C2 14 2 26 9.5 26" />
          <rect x="14" y="11" width="12" height="18" rx="1" />
          <path d="M30 14h9M30 18h9M30 22h9M30 26h6" />
        </g>
      )}
      {id === 'hefte' && (
        <g {...common}>
          <path d="M24 9 L7 5 V31 L24 35 L41 31 V5 Z" />
          <path d="M24 9 V35" />
          <path d="M11 12l9 2M11 17l9 2M11 22l9 2M28 14l9-2M28 19l9-2M28 24l9-2" />
        </g>
      )}
      {id === 'minibok' && (
        <g {...common}>
          <rect x="4" y="6" width="40" height="28" rx="2" />
          <path d="M14 6v28M24 6v28M34 6v28" strokeDasharray="1.5 2.5" />
          <path d="M4 20h10M34 20h10" strokeDasharray="1.5 2.5" />
          <path d="M14 20h20" strokeDasharray="3 2" strokeWidth="2.2" />
        </g>
      )}
    </svg>
  );
};

interface PrintDialogProps {
  story: SavedStory;
  onClose: () => void;
}

export const PrintDialog: React.FC<PrintDialogProps> = ({ story, onClose }) => {
  const [format, setFormat] = useState<PrintFormat | null>(null);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const longest = Math.max(0, ...story.segments.map((s) => s.text.length));
  const minibookFits = story.segments.length <= MINIBOOK_MAX_PAGES && longest <= MINIBOOK_MAX_CHARS;
  const chosen = FORMATS.find((f) => f.id === format) ?? null;
  const sheetCount = format ? buildSheets(format, story.segments.length).length : 0;
  const paperCount = format === 'hefte' ? sheetCount / 2 : sheetCount;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Get the pages ready: wait for the fonts and the pictures, then fit the text.
  useEffect(() => {
    const root = rootRef.current;
    if (!format || !root) return;
    let gone = false;
    setReady(false);
    setMissing(0);
    void (async () => {
      try {
        await Promise.all(
          ['12pt Lora', 'bold 12pt Lora', 'italic 12pt Lora', 'bold 12pt Quicksand', '12pt Quicksand'].map((f) =>
            document.fonts.load(f)
          )
        );
      } catch {
        /* the fallback font is used */
      }
      const images = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.race([
        Promise.all(
          images.map((img) =>
            img.complete
              ? null
              : new Promise((done) => {
                  img.onload = img.onerror = () => done(null);
                })
          )
        ),
        new Promise((done) => setTimeout(done, 12000)),
      ]);
      if (gone) return;
      let bad = 0;
      images.forEach((img) => {
        if (!img.naturalWidth) {
          bad++;
          img.style.display = 'none';
        }
      });
      fitText(root);
      setMissing(bad);
      setReady(true);
    })();
    return () => {
      gone = true;
    };
  }, [format, story]);

  const print = () => {
    if (!chosen || !ready) return;
    logEvent('Eventyr skrevet ut', { format: chosen.name });
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skriv-ut-tittel"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-gray-800 border-2 border-indigo-100 dark:border-indigo-900 shadow-2xl p-5 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="skriv-ut-tittel" className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">
              Skriv ut eventyret
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Eventyret om {story.options.character}. Velg hva slags bok det skal bli.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 -mt-1 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Lukk"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => {
            const disabled = f.id === 'minibok' && !minibookFits;
            const selected = format === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => setFormat(f.id)}
                className={`flex items-start gap-3 text-left rounded-2xl border-2 p-4 transition-colors ${
                  selected
                    ? 'border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/40'
                    : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-gray-200 dark:hover:border-gray-700' : ''}`}
              >
                <span className={selected ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}>
                  <FormatIcon id={f.id} />
                </span>
                <span>
                  <span className="block font-bold text-gray-900 dark:text-gray-100">{f.name}</span>
                  <span className="block mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                    {disabled ? 'Passer bare for korte eventyr – dette har for mye tekst til så små sider.' : f.about}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {chosen && (
          <div className="mt-5 rounded-2xl bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/30 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
            <p className="font-bold">
              Slik gjør du det ({paperCount} ark)
            </p>
            <ol className="mt-1 list-decimal pl-5 space-y-0.5">
              {chosen.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="mt-2 text-xs opacity-80">
              Tips: Velg 100 % størrelse og slå av topp- og bunntekst i utskriftsvinduet.
            </p>
          </div>
        )}

        {chosen && ready && missing > 0 && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-300">
            Noen av bildene lot seg ikke hente. Last siden på nytt og prøv igjen for å få dem med.
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-5 py-3 font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={print}
            disabled={!chosen || !ready}
            className="rounded-xl bg-indigo-600 text-white font-semibold px-6 py-3 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
          >
            <Printer className="w-5 h-5" />
            {!chosen ? 'Velg et format' : ready ? 'Skriv ut' : 'Gjør klar sidene …'}
          </button>
        </div>
      </div>

      {format &&
        createPortal(
          <div id="print-root" ref={rootRef} aria-hidden="true">
            <style>{`${PRINT_CSS}\n@page { size: A4 ${chosen?.landscape ? 'landscape' : 'portrait'}; margin: 0; }`}</style>
            <PrintPages key={format} story={story} format={format} />
          </div>,
          document.body
        )}
    </div>
  );
};

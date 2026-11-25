// The one button in the header for someone who is logged in: «Min profil».
// It shows how many wishes there are, and opens a small menu with the
// wishes, Min side, light/dark theme and log out.
import React, { useEffect, useRef, useState } from 'react';
import { Wishes, wishCount, wishTotal } from '../types';
import { ChevronDown, Library, LogOut, Moon, Star, Sun, User } from 'lucide-react';

interface ProfileMenuProps {
  fornavn: string;
  // The wishes the account has; null until a plan is chosen (or unknown).
  wishes: Wishes | null;
  // Min side is offered (a plan has been chosen), and how many stories are saved.
  showProfile: boolean;
  savedCount: number;
  // Min side is the page on screen.
  profileActive: boolean;
  theme: 'light' | 'dark';
  onOpenWishes: () => void;
  onOpenProfile: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}

const ITEM =
  'flex w-full items-center gap-3 px-4 py-3 text-left text-base font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors';

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
  fornavn,
  wishes,
  showProfile,
  savedCount,
  profileActive,
  theme,
  onOpenWishes,
  onOpenProfile,
  onToggleTheme,
  onLogout,
}) => {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  // A tap outside the menu, or Escape, closes it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (host.current && !host.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const total = wishTotal(wishes);

  return (
    <div ref={host} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={wishes ? `Min profil. Du har ${wishCount(total)}` : 'Min profil'}
        className={`inline-flex items-center gap-2 pl-3 pr-2.5 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${
          open || profileActive
            ? 'bg-indigo-100 text-indigo-800 dark:bg-white/20 dark:text-white'
            : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/20'
        }`}
      >
        <User className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Min profil</span>
        {wishes && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-400/20 px-2 py-0.5 text-amber-900 dark:text-amber-100">
            <Star
              className={`w-3.5 h-3.5 ${total > 0 ? 'fill-amber-400 text-amber-500' : 'text-gray-400'}`}
              aria-hidden="true"
            />
            {total}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl"
        >
          {fornavn && (
            <p className="px-4 pt-3 pb-2 text-sm font-semibold text-gray-500 dark:text-gray-400 truncate">
              Hei, {fornavn}
            </p>
          )}
          {wishes && (
            <button type="button" role="menuitem" onClick={pick(onOpenWishes)} className={ITEM}>
              <Star className="w-5 h-5 shrink-0 fill-amber-400 text-amber-500" aria-hidden="true" />
              <span className="flex-1">{wishCount(total)}</span>
            </button>
          )}
          {showProfile && (
            <button type="button" role="menuitem" onClick={pick(onOpenProfile)} className={ITEM}>
              <Library className="w-5 h-5 shrink-0 text-indigo-500 dark:text-indigo-300" aria-hidden="true" />
              <span className="flex-1">Min side</span>
              {savedCount > 0 && (
                <span className="min-w-[1.5rem] px-1.5 rounded-full bg-indigo-600 text-white text-xs leading-6 text-center">
                  {savedCount}
                </span>
              )}
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(onToggleTheme)} className={ITEM}>
            {theme === 'dark' ? (
              <Sun className="w-5 h-5 shrink-0 text-gray-500 dark:text-gray-300" aria-hidden="true" />
            ) : (
              <Moon className="w-5 h-5 shrink-0 text-gray-500 dark:text-gray-300" aria-hidden="true" />
            )}
            <span className="flex-1">{theme === 'dark' ? 'Lyst tema' : 'Mørkt tema'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pick(onLogout)}
            className={`${ITEM} border-t border-gray-200 dark:border-gray-700`}
          >
            <LogOut className="w-5 h-5 shrink-0 text-gray-500 dark:text-gray-300" aria-hidden="true" />
            <span className="flex-1">Logg ut</span>
          </button>
        </div>
      )}
    </div>
  );
};

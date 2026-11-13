import React, { useState, useEffect, useRef } from 'react';
import { SetupScreen } from './components/SetupScreen';
import { BookPage } from './components/BookPage';
import { ProfileScreen, SaveState } from './components/ProfileScreen';
import { PlanScreen } from './components/PlanScreen';
import { PageTurnAnimation } from './components/PageTurnAnimation';
import { StoryOptions, StorySegment, Choice, SavedStory, StoryPlan, SideCharacter, DURATIONS, GUEST_PAGES, PLAN_NAMES, TOTAL_PAGES } from './types';
import { generateCharacterSheet, generateIllustration, generateOpener, generatePage } from './services/geminiService';
import {
  AccountStatus,
  chooseFreePlan,
  claimGuestStory,
  deleteStory as deleteStoryAccount,
  fetchStatus,
  forgetShareLink,
  initialStatus,
  loadLocalPreferences,
  loadStories,
  logout,
  pendingShareLink,
  redeemShareLink,
  rememberPreferences,
  rememberStatus,
  saveStory as saveStoryAccount,
  SetupPreferences,
} from './services/account';
import { PendingStory, savePendingStory, takePendingStory } from './services/guestStory';
import { logEvent, logStoryStarted } from './services/analytics';
import { AlertCircle, CheckCircle2, Library, Loader2, LogOut, MessageSquare, Sun, Moon } from 'lucide-react';

const FEEDBACK_URL = 'https://grinas.typeform.com/to/sFjrTX2j';

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Build time and commit, filled in by vite.config.ts.
declare const __APP_VERSION__: string;

const App: React.FC = () => {
  const [view, setView] = useState<'setup' | 'reading' | 'profile' | 'plan'>('setup');
  const [options, setOptions] = useState<StoryOptions | null>(null);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedStories, setSavedStories] = useState<SavedStory[]>([]);
  // The page on screen. `segments` is the path the reader has taken.
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  // What the reader picked on each page (page index -> choice index, -1 for
  // "Avslutt historien"). Folded into the segments when the story is saved.
  const [chosenByPage, setChosenByPage] = useState<Record<number, number>>({});
  // Shared by every page of the current story: the seed every page is
  // written with, and the premise (the problem the story is about).
  const [storyMeta, setStoryMeta] = useState<{ seed: number; premise: string } | null>(null);
  // Label of the choice whose page is still being written, if any.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  // Set while re-reading a saved story, so saving again updates that story
  // (same id, same stored illustrations) instead of making a copy.
  const [loadedStory, setLoadedStory] = useState<{ id: string; createdAt: number } | null>(null);
  // The story on screen was started without a login and is not yet counted
  // as anyone's: only the first GUEST_PAGES pages can be read.
  const [guestStory, setGuestStory] = useState(false);
  // "Log in to read on", shown when a guest picks a choice past those pages.
  const [loginGate, setLoginGate] = useState(false);
  const [leavingForLogin, setLeavingForLogin] = useState(false);
  // A good-news message (the red one is `error`).
  const [notice, setNotice] = useState<string | null>(null);
  // A share link for Prinsen was opened, and is waiting for a login.
  const [linkWaiting, setLinkWaiting] = useState(false);

  // Theme state. Dark unless the visitor has chosen light: the `dark` class
  // is set by an inline script in index.html before React
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
  const [account, setAccount] = useState<AccountStatus>(initialStatus());

  // The choices remembered between visits: age, reading length and drawing
  // style. They start from this browser's copy; the account's copy arrives a
  // moment later and wins — except for what was changed on this visit.
  const [prefs, setPrefs] = useState<SetupPreferences>(() => loadLocalPreferences());
  const prefsRef = useRef(prefs);
  const touchedPrefs = useRef(new Set<string>());
  // Whether an age was saved before this visit. Until one is, the setup
  // screen asks for it; afterwards it is changed on Min side.
  const [ageKnown, setAgeKnown] = useState(() => Boolean(loadLocalPreferences().ageGroup));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveSeq = useRef(0);

  const applyPrefs = (next: SetupPreferences) => {
    prefsRef.current = next;
    setPrefs(next);
  };

  // Change one or more of the choices: saved at once, here and on the account.
  const updatePrefs = (patch: SetupPreferences) => {
    Object.keys(patch).forEach(k => touchedPrefs.current.add(k));
    const next = { ...prefsRef.current, ...patch };
    applyPrefs(next);
    setAccount(prev => ({ ...prev, valg: next }));
    const seq = ++saveSeq.current;
    void rememberPreferences(next, account.innlogget).then(result => {
      if (saveSeq.current === seq) setSaveState(result);
    });
  };

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
      let status = await fetchStatus();
      if (cancelled) return;
      // A share link for Prinsen opened in this browser: use it now if
      // logged in, otherwise ask for a login.
      const link = pendingShareLink();
      if (link && status.plan === 'pro') {
        forgetShareLink();
      } else if (link) {
        const result = await redeemShareLink(link);
        if (cancelled) return;
        if (result === 'ok') {
          forgetShareLink();
          status = { ...status, plan: 'pro', freeLeft: null };
          rememberStatus(status);
          setNotice(`Velkommen! Du har fått ${PLAN_NAMES.pro}.`);
          logEvent('Prinsen-lenke brukt');
        } else if (result === 'login') {
          setLinkWaiting(true);
        } else if (result === 'wrong') {
          forgetShareLink();
          setError('Lenken virker ikke lenger.');
        }
      }
      setAccount(status);
      // Back from logging in halfway through a story: open it again.
      const pending = takePendingStory();
      if (pending) restorePendingStory(pending, status.innlogget);
      const fromAccount = Object.fromEntries(
        Object.entries(status.valg).filter(([k]) => !touchedPrefs.current.has(k))
      ) as SetupPreferences;
      applyPrefs({ ...prefsRef.current, ...fromAccount });
      if (status.valg.ageGroup) setAgeKnown(true);
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
    setAccount({ ...account, innlogget: false, fornavn: '', valg: {}, plan: null, freeLeft: null });
    setNotice(null);
    setView('setup');
    // After sign-out, the user sees their local IndexedDB stories again.
    try {
      const stories = await loadStories(false);
      setSavedStories(stories);
    } catch {
      setSavedStories([]);
    }
  };

  // ---- Story flow ---------------------------------------------------------
  //
  // Page 1 comes from /api/opener (fast). From then on, whenever the reader is
  // on the last page of the path, BOTH possible next pages are written in the
  // background (/api/side, one per choice), each knowing exactly what was
  // chosen. Tapping a choice turns the page at once if it's ready, otherwise
  // "Neste side blir til…" shows until it is. Only the page the reader
  // actually lands on gets an illustration.
  //
  // A story can be started without a login. Such a story stops at
  // GUEST_PAGES: the choice on that page asks for a login, the story waits
  // in the browser meanwhile (services/guestStory.ts), and reading on counts
  // it as the account's story (unlockGuestStory).

  // Bumped for every new story, load and restart; async results that belong
  // to an older run are dropped.
  const runRef = useRef(0);
  // Character sheet for the current story. Made up front for new stories,
  // lazily for saved ones (only needed if the reader takes a new branch).
  const sheetRef = useRef<Promise<string | undefined> | null>(null);
  // The same sheet once it has arrived, so it can follow the story to Vipps and back.
  const sheetValue = useRef<string | undefined>(undefined);
  // Next-page requests, keyed by run + branch point + choice.
  const branchCache = useRef(new Map<string, Promise<StorySegment>>());
  // The running attempt to count a guest story on the account.
  const unlocking = useRef<Promise<boolean> | null>(null);

  const resetFlow = () => {
    runRef.current += 1;
    branchCache.current.clear();
    sheetRef.current = null;
    sheetValue.current = undefined;
    unlocking.current = null;
    setWaitingFor(null);
    setGuestStory(false);
    setLoginGate(false);
  };

  const getSheet = (opts: StoryOptions) => {
    if (!sheetRef.current) {
      const run = runRef.current;
      sheetRef.current = generateCharacterSheet(opts.character, opts.artStyle).then(sheet => {
        if (runRef.current === run) sheetValue.current = sheet;
        return sheet;
      });
    }
    return sheetRef.current;
  };

  // Count the guest story on screen as the logged-in user's, so it can be
  // read to the end. Asked once however many times it is called.
  const unlockGuestStory = (): Promise<boolean> => {
    if (!unlocking.current) {
      const run = runRef.current;
      unlocking.current = claimGuestStory().then(result => {
        if (runRef.current !== run) return false;
        if (result === 'ok') {
          setGuestStory(false);
          // On the free plan this was the week's free story.
          setAccount(prev =>
            prev.plan === 'pro' || prev.freeLeft === null
              ? prev
              : { ...prev, freeLeft: Math.max(0, prev.freeLeft - 1) }
          );
          return true;
        }
        unlocking.current = null;
        if (result === 'login') {
          setAccount(prev => ({ ...prev, innlogget: false }));
          setLoginGate(true);
        } else {
          setError(
            result === 'used'
              ? 'Du har brukt ukas gratis historie, så dette eventyret kan ikke fortsette nå. En ny historie kommer på mandag.'
              : 'Noe gikk galt. Prøv igjen om litt.'
          );
        }
        return false;
      });
    }
    return unlocking.current;
  };

  // Page `i` is the last one a guest story may show.
  const needsUnlock = (i: number) => guestStory && i >= GUEST_PAGES - 1;

  // A choice on a page that needs the story unlocked: ask for a login, or
  // unlock and go on.
  const continueGuestStory = async (label: string, go: () => void) => {
    if (!account.innlogget) {
      setLoginGate(true);
      logEvent('Innlogging bedt om', { side: currentPageIndex + 1 });
      return;
    }
    const run = runRef.current;
    setWaitingFor(label);
    setError(null);
    const ok = await unlockGuestStory();
    if (runRef.current !== run) return;
    if (ok) go();
    else setWaitingFor(null);
  };

  // Keep the story in the browser, then go to Vipps.
  const loginFromStory = async () => {
    if (leavingForLogin) return;
    setLeavingForLogin(true);
    logEvent('Vipps-innlogging klikket');
    if (options && storyMeta && segments.length > 0) {
      await savePendingStory({
        options,
        segments,
        chosenByPage,
        seed: storyMeta.seed,
        premise: storyMeta.premise,
        pageIndex: currentPageIndex,
        sheet: sheetValue.current,
      });
    }
    window.location.href = '/api/vipps/start';
  };

  // Every named side character along the path up to and including page `upTo`.
  const sideCharactersAlong = (segs: StorySegment[], upTo: number): SideCharacter[] => {
    const seen = new Map<string, SideCharacter>();
    const add = (s: SideCharacter) => {
      const key = s.name.toLowerCase();
      if (!seen.has(key)) seen.set(key, s);
    };
    (plan?.sideCharacters ?? []).forEach(add);
    segs.slice(0, upTo + 1).forEach(seg => (seg.sideCharacters ?? []).forEach(add));
    return [...seen.values()];
  };

  // The image endpoint takes at most 3 side characters: send the ones this
  // page mentions, falling back to the first few.
  const sideCharactersFor = (segment: StorySegment, all: SideCharacter[]) => {
    const haystack = `${segment.illustrationPrompt ?? ''} ${segment.text}`.toLowerCase();
    const named = all.filter(s => haystack.includes(s.name.toLowerCase()));
    return (named.length ? named : all).slice(0, 3);
  };

  // Fetches the illustration for page `index` and attaches it when it lands —
  // unless the reader has since started another story or taken another branch.
  const attachIllustrationAt = async (
    index: number,
    segment: StorySegment,
    opts: StoryOptions,
    sideCharacters: SideCharacter[]
  ) => {
    const run = runRef.current;
    const sheet = await getSheet(opts);
    const image = await generateIllustration(
      segment,
      opts,
      sideCharactersFor(segment, sideCharacters),
      sheet
    );
    if (!image || runRef.current !== run) return;
    setSegments(prev => {
      if (prev[index]?.text !== segment.text) return prev;
      const next = [...prev];
      next[index] = { ...next[index], imageBase64: image };
      return next;
    });
  };

  // Starts (or reuses) the request for the page behind choice `choiceIdx` on
  // page `i`. choiceIdx -1 is the grown-up's "end the story on the next page".
  const requestBranch = (
    segs: StorySegment[],
    chosen: Record<number, number>,
    i: number,
    choiceIdx: number
  ): Promise<StorySegment> => {
    const key = `${runRef.current}|${i}|${choiceIdx}|${segs[i].text}`;
    const cached = branchCache.current.get(key);
    if (cached) return cached;
    if (!options || !storyMeta) return Promise.reject(new Error('Ingen historie å fortsette.'));
    const path = segs.slice(0, i + 1).map((s, j) => {
      const c = j === i ? choiceIdx : chosen[j];
      return { text: s.text, choice: c !== undefined && c >= 0 ? s.choices[c] : undefined };
    });
    const promise = generatePage({
      options,
      seed: storyMeta.seed,
      premise: storyMeta.premise,
      path,
      sideCharacters: sideCharactersAlong(segs, i),
      forceEnding: choiceIdx === -1,
    });
    branchCache.current.set(key, promise);
    // Forget a failed request, so tapping again retries it.
    promise.catch(() => {
      if (branchCache.current.get(key) === promise) branchCache.current.delete(key);
    });
    return promise;
  };

  // While the reader is on the last page of the path, write both next pages.
  useEffect(() => {
    if (view !== 'reading') return;
    const i = currentPageIndex;
    const seg = segments[i];
    if (!seg || seg.isEnding || i !== segments.length - 1) return;
    // The next pages of a guest story are written once it is unlocked.
    if (needsUnlock(i)) return;
    seg.choices.forEach((_, k) => {
      requestBranch(segments, chosenByPage, i, k).catch(() => undefined);
    });
    // requestBranch is recreated every render; the cache makes repeats free.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentPageIndex, segments, chosenByPage, storyMeta, options, guestStory]);

  // Turn to the page behind `choiceIdx` on page `i`, waiting for it if needed.
  const goToBranch = async (i: number, choiceIdx: number, label: string) => {
    if (!options) return;
    const run = runRef.current;
    const segs = segments.slice(0, i + 1);
    const chosen: Record<number, number> = {};
    for (let j = 0; j < i; j++) {
      if (chosenByPage[j] !== undefined) chosen[j] = chosenByPage[j];
    }
    chosen[i] = choiceIdx;
    setWaitingFor(label);
    setError(null);
    try {
      const next = await requestBranch(segs, chosen, i, choiceIdx);
      if (runRef.current !== run) return;
      setSegments(prev => [...prev.slice(0, i + 1), next]);
      setChosenByPage(chosen);
      setCurrentPageIndex(i + 1);
      logEvent('Side lest', { side: i + 2 });
      if (next.isEnding) logEvent('Eventyr ferdig', { sider: i + 2, avsluttetTidlig: choiceIdx === -1 });
      void attachIllustrationAt(i + 1, next, options, sideCharactersAlong([...segs, next], i + 1));
    } catch (err) {
      if (runRef.current !== run) return;
      const msg = err instanceof Error ? err.message : '';
      setError(msg || 'Klarte ikke å lage neste side. Prøv igjen.');
    } finally {
      if (runRef.current === run) setWaitingFor(null);
    }
  };

  const handleStartStory = async (selectedOptions: StoryOptions) => {
    resetFlow();
    const run = runRef.current;
    setOptions(selectedOptions);
    setPlan(null);
    setStoryMeta(null);
    setSegments([]);
    setCurrentPageIndex(0);
    setChosenByPage({});
    setLoadedStory(null);
    setIsLoading(true);
    setError(null);
    const seed = Math.floor(Math.random() * 1_000_000_000);
    try {
      // Start the character sheet now so it's ready for page 1's picture.
      void getSheet(selectedOptions);
      const { segment: opener, premise, guest } = await generateOpener(selectedOptions, seed);
      if (runRef.current !== run) return;
      logStoryStarted(selectedOptions);
      setGuestStory(guest);
      // One of this week's free stories is used.
      if (!guest) {
        setAccount(prev =>
          prev.plan === 'pro' || prev.freeLeft === null
            ? prev
            : { ...prev, freeLeft: Math.max(0, prev.freeLeft - 1) }
        );
      }
      setStoryMeta({ seed, premise });
      setSegments([opener]);
      setView('reading');
      setIsLoading(false);
      void attachIllustrationAt(0, opener, selectedOptions, opener.sideCharacters ?? []);
    } catch (err) {
      if (runRef.current !== run) return;
      const msg = err instanceof Error ? err.message : "";
      setError(msg || "Beklager, vi klarte ikke å starte historien. Prøv igjen om et minutt.");
      logEvent('Oppstart feilet');
      setIsLoading(false);
    }
  };

  const handleChoice = (choice: Choice) => {
    const i = currentPageIndex;
    const seg = segments[i];
    const k = seg ? seg.choices.indexOf(choice) : -1;
    if (!seg || k < 0 || waitingFor) return;
    // Re-reading a saved story along the same path — or a story saved before
    // choices mattered, where every choice led to the same page: just turn.
    const prior = chosenByPage[i];
    if (segments[i + 1] && (prior === k || prior === undefined)) {
      setChosenByPage(prev => ({ ...prev, [i]: k }));
      setCurrentPageIndex(i + 1);
      return;
    }
    if (needsUnlock(i)) {
      void continueGuestStory(choice.text, () => void goToBranch(i, k, choice.text));
      return;
    }
    void goToBranch(i, k, choice.text);
  };

  // Parent escape hatch: the next page becomes the ending.
  const handleWrapUp = () => {
    const i = currentPageIndex;
    if (!segments[i] || waitingFor) return;
    if (segments[i + 1]?.isEnding && chosenByPage[i] === -1) {
      setCurrentPageIndex(i + 1);
      return;
    }
    if (needsUnlock(i)) {
      void continueGuestStory('Avslutt historien', () => void goToBranch(i, -1, 'Avslutt historien'));
      return;
    }
    void goToBranch(i, -1, 'Avslutt historien');
  };

  // Open the story that was waiting while the reader logged in.
  const restorePendingStory = (pending: PendingStory, innlogget: boolean) => {
    resetFlow();
    if (pending.sheet) {
      sheetRef.current = Promise.resolve(pending.sheet);
      sheetValue.current = pending.sheet;
    }
    setOptions(pending.options);
    setPlan(null);
    setStoryMeta({ seed: pending.seed, premise: pending.premise });
    setSegments(pending.segments);
    setChosenByPage(pending.chosenByPage);
    setCurrentPageIndex(pending.pageIndex);
    setLoadedStory(null);
    setGuestStory(true);
    setView('reading');
    if (innlogget) void unlockGuestStory();
    // A picture that hadn't arrived when the reader left is drawn now.
    const page = pending.segments[pending.pageIndex];
    if (page && !page.imageBase64) {
      const seen = new Map<string, SideCharacter>();
      pending.segments
        .slice(0, pending.pageIndex + 1)
        .forEach(seg => (seg.sideCharacters ?? []).forEach(s => {
          if (!seen.has(s.name.toLowerCase())) seen.set(s.name.toLowerCase(), s);
        }));
      void attachIllustrationAt(pending.pageIndex, page, pending.options, [...seen.values()]);
    }
  };

  const handleRestart = () => {
    resetFlow();
    setSegments([]);
    setOptions(null);
    setPlan(null);
    setStoryMeta(null);
    setCurrentPageIndex(0);
    setChosenByPage({});
    setLoadedStory(null);
    setView('setup');
    setError(null);
  };

  // Gratis or Pro. Pro is given through a share link for now.
  const isPro = account.plan === 'pro';
  const openPlan = () => {
    resetFlow();
    setView('plan');
    setError(null);
    logEvent('Plansiden åpnet');
    window.scrollTo({ top: 0 });
  };
  const applyPlan = (plan: 'gratis' | 'pro') => {
    setAccount(prev => {
      const next = { ...prev, plan, freeLeft: plan === 'pro' ? null : prev.freeLeft };
      rememberStatus(next);
      return next;
    });
    logEvent('Plan valgt', { plan });
    setView('setup');
    window.scrollTo({ top: 0 });
  };
  const handleChooseFree = async (): Promise<boolean> => {
    const ok = await chooseFreePlan();
    if (ok) applyPlan('gratis');
    return ok;
  };

  // Min side: saved stories and the remembered choices.
  const openProfile = () => {
    resetFlow();
    setSaveState('idle');
    setView('profile');
    logEvent('Min side åpnet');
    setError(null);
    window.scrollTo({ top: 0 });
  };

  const handleSaveStory = async (): Promise<boolean> => {
    if (!options || segments.length === 0) return false;

    const newStory: SavedStory = {
      id: loadedStory?.id ?? generateId(),
      createdAt: loadedStory?.createdAt ?? Date.now(),
      options: options,
      segments: segments.map((s, i) =>
        chosenByPage[i] !== undefined ? { ...s, chosenIndex: chosenByPage[i] } : s
      ),
      plan: plan ?? undefined,
      premise: storyMeta?.premise,
      seed: storyMeta?.seed,
      ...(guestStory ? { guestStarted: true } : {}),
    };

    try {
      const ok = await saveStoryAccount(newStory, account.innlogget);
      if (!ok) throw new Error('save-failed');
      logEvent('Eventyr lagret', { innlogget: account.innlogget });
      setSavedStories(prev =>
        prev.some(s => s.id === newStory.id)
          ? prev.map(s => (s.id === newStory.id ? newStory : s))
          : [newStory, ...prev]
      );
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
    resetFlow();
    // Backward compatibility for stories saved before duration was added
    const storyOptions = { ...story.options };
    if (!storyOptions.duration) {
      storyOptions.duration = DURATIONS[1]; // Default to 5 min
    }
    const chosen: Record<number, number> = {};
    story.segments.forEach((s, i) => {
      if (typeof s.chosenIndex === 'number') chosen[i] = s.chosenIndex;
    });
    if (story.plan?.characterSheetBase64) {
      sheetRef.current = Promise.resolve(story.plan.characterSheetBase64);
    }

    setOptions(storyOptions);
    setPlan(story.plan ?? null);
    setStoryMeta({
      seed: story.seed ?? Math.floor(Math.random() * 1_000_000_000),
      premise: story.premise ?? story.plan?.logline ?? '',
    });
    setSegments(story.segments);
    setCurrentPageIndex(0);
    setChosenByPage(chosen);
    setLoadedStory({ id: story.id, createdAt: story.createdAt });
    setGuestStory(story.guestStarted === true);
    setView('reading');
    logEvent('Lagret eventyr åpnet');
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

  const currentSegment = segments[currentPageIndex];
  // The choice that led to the page on screen, shown as "Du valgte: …".
  const prevChoice = currentPageIndex > 0 ? chosenByPage[currentPageIndex - 1] : undefined;
  const arrivedVia =
    prevChoice !== undefined && prevChoice >= 0
      ? segments[currentPageIndex - 1]?.choices[prevChoice]?.text
      : undefined;

  // Every story is now exactly TOTAL_PAGES pages regardless of duration.
  const estimatedPages = TOTAL_PAGES;

  const isReading = view === 'reading';

  return (
    <div className={`min-h-screen ${isReading ? 'lg:h-screen lg:overflow-hidden' : ''} bg-[#e8e6e1] dark:bg-[#15161a] text-gray-900 dark:text-gray-100 transition-colors flex flex-col`}>
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
              <button
                onClick={handleRestart}
                className="flex items-center cursor-pointer bg-white dark:bg-[#000c31] rounded-xl px-2 py-1 dark:p-0 overflow-hidden shadow-sm ring-1 ring-gray-200 dark:ring-indigo-900"
                aria-label="Magiboka — til forsiden"
              >
                {/* The dark logo carries its own night-blue background and padding. */}
                <img src="/magiboka-logo.webp" alt="Magiboka" className="h-8 md:h-10 w-auto dark:hidden" />
                <img src="/magiboka-logo-dark.webp" alt="Magiboka" width={645} height={188} className="hidden dark:block h-10 md:h-12 w-auto" />
              </button>
              <div className="flex items-center gap-2 sm:gap-3">
                {account.innlogget && account.plan && (
                <button
                  onClick={openProfile}
                  aria-current={view === 'profile' ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                    view === 'profile'
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-100'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Library className="w-4 h-4" />
                  <span>Min side</span>
                  {savedStories.length > 0 && (
                    <span className="ml-0.5 min-w-[1.25rem] px-1 rounded-full bg-indigo-600 text-white text-xs leading-5 text-center">
                      {savedStories.length}
                    </span>
                  )}
                </button>
                )}
                <button
                  onClick={toggleTheme}
                  aria-label={theme === 'dark' ? 'Bytt til lyst tema' : 'Bytt til mørkt tema'}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                {account.innlogget ? (
                  <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <span className="hidden sm:inline font-semibold truncate max-w-[10rem]">Hei{account.fornavn ? `, ${account.fornavn}` : ''}</span>
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
                    onClick={() => logEvent('Vipps-innlogging klikket')}
                    className="inline-flex items-center px-3 sm:px-4 py-2 rounded-full bg-[#FF5B24] text-[#1A0B05] font-bold hover:bg-[#FF7445] text-sm md:text-base whitespace-nowrap"
                  >
                    Logg inn<span className="hidden sm:inline">&nbsp;med Vipps</span>
                  </a>
                ) : null}
              </div>
            </div>
          </header>
          {linkWaiting && !account.innlogget && (
            <div className="bg-amber-100 dark:bg-amber-900 text-amber-950 dark:text-amber-50 text-sm md:text-base py-2.5 px-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center">
              <span className="font-semibold">
                Du har fått {PLAN_NAMES.pro}: så mange historier dere vil, med alt inkludert.
              </span>
              {account.vippsReady ? (
                <a
                  href="/api/vipps/start"
                  onClick={() => logEvent('Vipps-innlogging klikket')}
                  className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#FF5B24] text-[#1A0B05] font-bold hover:bg-[#FF7445] whitespace-nowrap"
                >
                  Logg inn med Vipps
                </a>
              ) : (
                <span>Logg inn for å ta den i bruk.</span>
              )}
            </div>
          )}
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
            className="bg-white dark:bg-[#000c31] shadow-md rounded-full p-1.5 dark:p-0 overflow-hidden ring-1 ring-gray-200 dark:ring-indigo-900 transition-colors"
          >
            <img src="/magiboka-logo.webp" alt="Magiboka" className="h-5 w-auto dark:hidden" />
            <img src="/magiboka-logo-dark.webp" alt="Magiboka" width={645} height={188} className="hidden dark:block h-8 w-auto" />
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
        {notice && !error && (
          <div role="status" className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-emerald-100 border border-emerald-400 text-emerald-800 px-4 py-3 rounded flex items-center shadow-lg">
            <CheckCircle2 className="w-5 h-5 mr-2 shrink-0" />
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Lukk" className="ml-4 font-bold">✕</button>
          </div>
        )}

        {/* A guest has read the free pages: log in to read on. */}
        {isReading && loginGate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logg-inn-tittel"
          >
            <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-800 border-2 border-indigo-100 dark:border-indigo-900 shadow-2xl p-6 sm:p-8 text-center">
              <h2 id="logg-inn-tittel" className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">
                Logg inn for å lese videre
              </h2>
              <p className="mt-3 text-base text-gray-600 dark:text-gray-300">
                Eventyret venter her mens du logger inn. Én historie er gratis hver uke.
              </p>
              {account.vippsReady || !account.checked ? (
                <button
                  type="button"
                  onClick={loginFromStory}
                  disabled={leavingForLogin}
                  className="mt-6 flex w-full justify-center items-center gap-2 rounded-full bg-[#FF5B24] text-[#1A0B05] text-lg font-bold py-4 px-6 shadow-lg hover:bg-[#FF7445] disabled:opacity-70 transition-colors"
                >
                  {leavingForLogin && <Loader2 className="w-5 h-5 animate-spin" />}
                  Logg inn med Vipps
                </button>
              ) : (
                <p className="mt-6 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 py-4 px-4 font-semibold text-gray-600 dark:text-gray-300">
                  Innlogging er ikke tilgjengelig akkurat nå. Prøv igjen om litt.
                </p>
              )}
              <button
                type="button"
                onClick={() => setLoginGate(false)}
                disabled={leavingForLogin}
                className="mt-4 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline underline-offset-4"
              >
                Ikke nå
              </button>
            </div>
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

        {isReading ? null : account.innlogget && !account.plan ? (
          // First time after login: choose Gratis or Pro.
          account.checked ? (
            <PlanScreen
              currentPlan={null}
              onChooseFree={handleChooseFree}
              onBack={() => undefined}
            />
          ) : (
            <Loader2 className="w-8 h-8 mt-24 animate-spin text-indigo-400" aria-label="Laster" />
          )
        ) : view === 'plan' ? (
          <PlanScreen
            currentPlan={account.plan}
            onChooseFree={handleChooseFree}
            onBack={handleRestart}
          />
        ) : view === 'setup' ? (
          <SetupScreen 
            onStart={handleStartStory} 
            isLoading={isLoading} 
            preferences={prefs}
            onPreferenceChange={updatePrefs}
            askForAge={!ageKnown}
            onOpenProfile={() => openProfile()}
            isPro={isPro}
            freeLeft={account.freeLeft}
            onOpenPlan={openPlan}
            loggedIn={account.innlogget}
            canLogIn={account.vippsReady}
          />
        ) : view === 'profile' ? (
          <ProfileScreen
            fornavn={account.innlogget ? account.fornavn : ''}
            innlogget={account.innlogget}
            canLogIn={account.vippsReady}
            preferences={prefs}
            onPreferenceChange={updatePrefs}
            saveState={saveState}
            savedStories={savedStories}
            onLoadStory={handleLoadStory}
            onDeleteStory={handleDeleteStory}
            onBack={handleRestart}
            isPro={isPro}
            onOpenPlan={openPlan}
          />
        ) : null}

        {isReading && (
          currentSegment && (
            <BookPage
              segment={currentSegment}
              onChoice={handleChoice}
              onRestart={handleRestart}
              onSave={handleSaveStory}
              onWrapUp={handleWrapUp}
              waitingFor={waitingFor}
              arrivedVia={arrivedVia}
              isGenerating={isLoading}
              pageNumber={currentPageIndex + 1}
              totalPages={estimatedPages}
              isPro={isPro}
            />
          )
        )}
      </main>

      {/* Company details belong on the front page, not inside the story. */}
      {!isReading && (
      <footer className="bg-white/60 dark:bg-gray-900/60 border-t border-gray-200 dark:border-gray-800 py-4 px-6 text-xs text-gray-500 dark:text-gray-400">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
          <span>Nordgård</span>
          <span className="hidden sm:inline">·</span>
          <span>Org.nr. 937 095 082</span>
          <span className="hidden sm:inline">·</span>
          <a href="mailto:trymnord@gmail.com" className="hover:text-gray-700 dark:hover:text-gray-200 underline">trymnord@gmail.com</a>
        </div>
        <p className="mt-1 text-center text-[11px] text-gray-500 dark:text-gray-400">Versjon {__APP_VERSION__}</p>
      </footer>
      )}
    </div>
  );
};

export default App;
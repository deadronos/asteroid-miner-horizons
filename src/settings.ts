// Player preferences, stored separately from save slots so they apply to every
// game. Loaded values are merged over DEFAULTS, so new settings get sensible
// values on old installs. Subscribers are notified on every change.

export type Quality = 'low' | 'medium' | 'high';
export type Shake = 'off' | 'low' | 'full';
export type LogVerbosity = 'all' | 'important';

export type KeyAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'cycleShip'
  | 'follow'
  | 'map'
  | 'research'
  | 'help'
  | 'pause';

/** Two bindings per action (primary, secondary); null = unbound. Values are KeyboardEvent.code. */
export type KeyBindings = Record<KeyAction, [string | null, string | null]>;

export interface Settings {
  // Gameplay
  pauseInMenus: boolean;
  pauseUnfocused: boolean;
  autosaveSec: 0 | 10 | 30 | 60;
  confirmDestructive: boolean;
  assistAvoid: boolean;
  assistAutoDock: boolean;
  assistChain: boolean;
  // Graphics
  quality: Quality;
  nebula: boolean;
  antialias: boolean;
  shake: Shake;
  showFps: boolean;
  // Interface & camera
  hudScale: number;
  alwaysShowBars: boolean;
  showHelp: boolean;
  logVerbosity: LogVerbosity;
  followByDefault: boolean;
  zoomSpeed: number;
  edgePan: boolean;
  // Audio (not wired yet: there is no sound)
  volMaster: number;
  volSfx: number;
  volMusic: number;
  // Controls
  keys: KeyBindings;
}

export const KEY_ACTIONS: { id: KeyAction; label: string }[] = [
  { id: 'up', label: 'Thrust up' },
  { id: 'down', label: 'Thrust down' },
  { id: 'left', label: 'Thrust left' },
  { id: 'right', label: 'Thrust right' },
  { id: 'cycleShip', label: 'Next ship (Shift: previous)' },
  { id: 'follow', label: 'Follow selected ship' },
  { id: 'map', label: 'System map' },
  { id: 'research', label: 'Research panel' },
  { id: 'help', label: 'Toggle help' },
  { id: 'pause', label: 'Pause' },
];

export const DEFAULT_KEYS: KeyBindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  cycleShip: ['Tab', null],
  follow: ['KeyF', null],
  map: ['KeyM', null],
  research: ['KeyR', null],
  help: ['KeyH', null],
  pause: ['KeyP', 'Pause'],
};

/** Keys with a fixed meaning that can't be bound to an action. */
export const RESERVED_KEYS = new Set([
  'Escape',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
]);

export const DEFAULTS: Settings = {
  pauseInMenus: true,
  pauseUnfocused: true,
  autosaveSec: 10,
  confirmDestructive: true,
  assistAvoid: true,
  assistAutoDock: true,
  assistChain: true,
  quality: 'high',
  nebula: true,
  antialias: true,
  shake: 'full',
  showFps: false,
  hudScale: 1,
  alwaysShowBars: false,
  showHelp: true,
  logVerbosity: 'all',
  followByDefault: true,
  zoomSpeed: 1,
  edgePan: false,
  volMaster: 0.8,
  volSfx: 0.8,
  volMusic: 0.5,
  keys: DEFAULT_KEYS,
};

/** What each quality preset means for the renderer. */
export const QUALITY: Record<Quality, { pixelRatioCap: number; stars: number; particles: number }> = {
  low: { pixelRatioCap: 1, stars: 0.3, particles: 0.3 },
  medium: { pixelRatioCap: 1.5, stars: 0.6, particles: 0.65 },
  high: { pixelRatioCap: 2, stars: 1, particles: 1 },
};

export const SHAKE_SCALE: Record<Shake, number> = { off: 0, low: 0.35, full: 1 };

/** Human-readable name for a KeyboardEvent.code. */
export function keyLabel(code: string | null): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
  };
  return named[code] ?? code;
}

const KEY = 'asteroid-miner-horizons/settings';

export class SettingsStore {
  value: Settings;
  private subs: ((s: Settings) => void)[] = [];

  constructor(private readonly storage: Storage | null = SettingsStore.defaultStorage()) {
    this.value = SettingsStore.merge(this.read());
  }

  private static defaultStorage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private read(): unknown {
    try {
      const raw = this.storage?.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Defaults overlaid with whatever valid-typed values were stored. */
  static merge(data: unknown): Settings {
    const out: Settings = { ...DEFAULTS, keys: structuredClone(DEFAULT_KEYS) };
    if (!data || typeof data !== 'object') return out;
    const d = data as Record<string, unknown>;
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      if (k === 'keys') continue;
      if (typeof d[k] === typeof DEFAULTS[k]) (out as unknown as Record<string, unknown>)[k] = d[k];
    }
    const keys = d.keys as Partial<KeyBindings> | undefined;
    if (keys && typeof keys === 'object') {
      for (const a of Object.keys(DEFAULT_KEYS) as KeyAction[]) {
        const b = keys[a];
        if (Array.isArray(b) && b.length === 2 && b.every((x) => x === null || typeof x === 'string'))
          out.keys[a] = [b[0], b[1]];
      }
    }
    return out;
  }

  set(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* storage blocked: settings last for this session only */
    }
    for (const fn of this.subs) fn(this.value);
  }

  /**
   * Binds `code` to action slot `slot`, removing it from any other action so
   * one key never triggers two actions. Returns the action it was taken from.
   */
  bind(action: KeyAction, slot: 0 | 1, code: string | null): KeyAction | null {
    const keys = structuredClone(this.value.keys);
    let stolen: KeyAction | null = null;
    if (code) {
      for (const a of Object.keys(keys) as KeyAction[]) {
        keys[a] = keys[a].map((c) => {
          if (c === code && !(a === action && keys[a][slot] === code)) {
            if (a !== action) stolen = a;
            return null;
          }
          return c;
        }) as [string | null, string | null];
      }
    }
    keys[action][slot] = code;
    this.set({ keys });
    return stolen;
  }

  resetKeys(): void {
    this.set({ keys: structuredClone(DEFAULT_KEYS) });
  }

  onChange(fn: (s: Settings) => void): void {
    this.subs.push(fn);
  }
}

/** Reverse lookup: which action (if any) a key code triggers. */
export function actionFor(keys: KeyBindings, code: string): KeyAction | null {
  for (const a of Object.keys(keys) as KeyAction[]) if (keys[a].includes(code)) return a;
  return null;
}

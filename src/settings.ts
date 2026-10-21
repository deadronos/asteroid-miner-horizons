// Player preferences, stored separately from save slots so they apply to every
// game. Loaded values are merged over DEFAULTS, so new settings get sensible
// values on old installs. Subscribers are notified on every change.

import { HAZARD_LEVEL_IDS, type HazardLevel } from './data/hazards';
import { safeStorage } from './sim/save';

export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type RenderScale = 0.75 | 1;
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
  | 'pause'
  | 'outpost';

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
  hazards: HazardLevel;
  /** Credit drone and outpost income for the time a save was closed. */
  offlineProgress: boolean;
  /** Autorepair sends a ship home below this share of its hull (#140). */
  autoRepairAt: 0.25 | 0.5 | 0.75;
  /** Units of each resource fleet automation never spends (#140). */
  autoReserve: 0 | 50 | 100 | 250 | 500 | 1000;
  // Graphics
  quality: Quality;
  renderScale: RenderScale;
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
  // Audio
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
  { id: 'outpost', label: 'Deploy outpost on hovered asteroid' },
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
  outpost: ['KeyO', null],
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
  hazards: 'normal',
  offlineProgress: true,
  autoRepairAt: 0.5,
  autoReserve: 100,
  quality: 'high',
  renderScale: 1,
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

/** What each quality preset means for the renderer. `bloom` is the glow strength (0 = no post-processing). */
export const QUALITY: Record<
  Exclude<Quality, 'auto'>,
  { pixelRatioCap: number; stars: number; particles: number; bloom: number }
> = {
  low: { pixelRatioCap: 1, stars: 0.3, particles: 0.3, bloom: 0 },
  medium: { pixelRatioCap: 1.5, stars: 0.6, particles: 0.65, bloom: 0.75 },
  high: { pixelRatioCap: 2, stars: 1, particles: 1, bloom: 0.9 },
};

export const QUALITY_IDS = Object.keys(QUALITY) as Exclude<Quality, 'auto'>[];
export const QUALITY_MODES: Quality[] = ['auto', ...QUALITY_IDS];

export const SHAKE_SCALE: Record<Shake, number> = { off: 0, low: 0.35, full: 1 };

export const SHAKE_IDS = Object.keys(SHAKE_SCALE) as Shake[];

export const LOG_VERBOSITY_IDS = ['all', 'important'] as const;

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

const AUTOSAVE_SEC_VALUES = [0, 10, 30, 60] as const;
export const AUTO_REPAIR_AT_VALUES = [0.25, 0.5, 0.75] as const;
export const AUTO_RESERVE_VALUES = [0, 50, 100, 250, 500, 1000] as const;
const HUD_SCALE_RANGE = [0.5, 2] as const;
const ZOOM_SPEED_RANGE = [0.25, 4] as const;
const VOLUME_RANGE = [0, 1] as const;

/** True when `v` is a finite number inside the inclusive `[lo, hi]` range. */
const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export class SettingsStore {
  value: Settings;
  private subs: ((s: Settings) => void)[] = [];

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.value = SettingsStore.merge(this.read());
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
      if (k === 'hazards') {
        if (HAZARD_LEVEL_IDS.includes(d[k] as HazardLevel)) out.hazards = d[k] as HazardLevel;
        continue;
      }
      switch (k) {
        case 'quality':
          if (QUALITY_MODES.includes(d[k] as Quality)) out.quality = d[k] as Quality;
          continue;
        case 'renderScale':
          if (d[k] === 0.75 || d[k] === 1) out.renderScale = d[k];
          continue;
        case 'shake':
          if (SHAKE_IDS.includes(d[k] as Shake)) out.shake = d[k] as Shake;
          continue;
        case 'logVerbosity':
          if (LOG_VERBOSITY_IDS.includes(d[k] as LogVerbosity)) out.logVerbosity = d[k] as LogVerbosity;
          continue;
        case 'autosaveSec':
          if (AUTOSAVE_SEC_VALUES.includes(d[k] as Settings['autosaveSec']))
            out.autosaveSec = d[k] as Settings['autosaveSec'];
          continue;
        case 'autoRepairAt':
          if (AUTO_REPAIR_AT_VALUES.includes(d[k] as Settings['autoRepairAt']))
            out.autoRepairAt = d[k] as Settings['autoRepairAt'];
          continue;
        case 'autoReserve':
          if (AUTO_RESERVE_VALUES.includes(d[k] as Settings['autoReserve']))
            out.autoReserve = d[k] as Settings['autoReserve'];
          continue;
        case 'hudScale':
          if (inRange(d[k], HUD_SCALE_RANGE)) out.hudScale = d[k];
          continue;
        case 'zoomSpeed':
          if (inRange(d[k], ZOOM_SPEED_RANGE)) out.zoomSpeed = d[k];
          continue;
        case 'volMaster':
        case 'volSfx':
        case 'volMusic':
          if (inRange(d[k], VOLUME_RANGE)) out[k] = d[k];
          continue;
      }
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

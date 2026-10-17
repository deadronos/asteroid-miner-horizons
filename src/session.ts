// The playing session: which save slot is running, the live GameState, and
// every way it changes (load, new game, import, delete, autosave). `main.ts`
// only wires the renderer, HUD, input and loop around this.

import { newGame } from './sim/create';
import { activeSlot, clearSlot, migrateLegacy, readSlot, type SaveRecord, setActiveSlot, writeSlot } from './sim/save';
import type { GameState } from './sim/types';
import type { SettingsStore } from './settings';

/** Save-slot actions the gear menu drives. */
export interface SaveActions {
  active(): number;
  current(): GameState;
  saveNow(): void;
  load(slot: number): void;
  newGame(slot: number): void;
  importTo(slot: number, record: SaveRecord): void;
  remove(slot: number): void;
}

export interface GameSessionHooks {
  /** The running game was swapped for a different one (load, new game, restart). */
  onSwitch?(): void;
}

export class GameSession implements SaveActions {
  private running: GameState;
  private slot: number;
  private autosaveTimer = 0;
  /** The interval the timer runs at, or null while stopped. */
  private armedSec: number | null = null;
  private detach: (() => void) | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly hooks: GameSessionHooks = {},
  ) {
    migrateLegacy();
    this.slot = activeSlot();
    this.running = readSlot(this.slot)?.state ?? newGame();
    if (this.running.run.time > 0) this.logLoaded(this.slot);
    // Only a change to the interval restarts the timer, so unrelated settings
    // (a volume drag, say) don't keep pushing the next autosave back.
    settings.onChange((v) => {
      if (this.armedSec !== null && v.autosaveSec !== this.armedSec) this.armAutosave();
    });
  }

  /** The running game. Replaced only through load / newGame. */
  get state(): GameState {
    return this.running;
  }

  active(): number {
    return this.slot;
  }

  current(): GameState {
    return this.state;
  }

  /** Save now, with the notice the menu shows. */
  saveNow(): void {
    this.persist();
    this.state.out.log.push({ level: 'info', text: `Saved to slot ${this.slot + 1}.` });
  }

  /** Switch to the save in slot `i`, saving the running game first. */
  load(i: number): void {
    const rec = readSlot(i);
    if (!rec) return;
    this.switchTo(i, rec.state);
    this.logLoaded(i);
  }

  /** Start a brand-new game in slot `i`. */
  newGame(i: number): void {
    // Save the old game unless this restarts its own slot, which the new game
    // overwrites anyway.
    if (i === this.slot) clearSlot(i);
    else this.persist();
    this.slot = i;
    setActiveSlot(i);
    this.running = newGame();
    this.hooks.onSwitch?.();
    this.persist();
  }

  /** Copy an imported record into slot `i`; the running game is untouched. */
  importTo(i: number, rec: SaveRecord): void {
    writeSlot(i, rec.state);
    this.state.out.log.push({ level: 'info', text: `Imported a save into slot ${i + 1}.` });
  }

  /** Delete slot `i`, unless it holds the running game. */
  remove(i: number): void {
    if (i !== this.slot) clearSlot(i);
  }

  /** Autosave on the interval, plus a save when the tab is hidden or closed. Idempotent. */
  start(): void {
    if (this.armedSec !== null) return;
    this.armAutosave();
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const persist = (): void => this.persist();
    const onHide = (): void => {
      if (document.hidden) persist();
    };
    window.addEventListener('beforeunload', persist);
    document.addEventListener('visibilitychange', onHide);
    this.detach = () => {
      window.removeEventListener('beforeunload', persist);
      document.removeEventListener('visibilitychange', onHide);
    };
  }

  /** Stop the autosave timer and drop the page listeners. */
  stop(): void {
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = 0;
    this.armedSec = null;
    this.detach?.();
    this.detach = null;
  }

  /** Swap the running game, saving the old one to its slot and the new one to its. */
  private switchTo(next: number, nextState: GameState): void {
    this.persist();
    this.slot = next;
    setActiveSlot(next);
    this.running = nextState;
    this.hooks.onSwitch?.();
    this.persist();
  }

  /** (Re)start the autosave timer from the current settings. */
  private armAutosave(): void {
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = 0;
    const sec = this.settings.value.autosaveSec;
    this.armedSec = sec;
    if (sec > 0) this.autosaveTimer = setInterval(() => this.persist(), sec * 1000);
  }

  /** Write the running game to its slot, silently. */
  private persist(): void {
    writeSlot(this.slot, this.state);
  }

  private logLoaded(i: number): void {
    this.state.out.log.push({
      level: 'major',
      text: `Slot ${i + 1} loaded: system ${this.state.run.system.number}, ${this.state.run.system.name}.`,
    });
  }
}

// The playing session: which save slot is running, the live GameState, and
// every way it changes (load, new game, import, delete, autosave). Loading a
// save credits offline progress for the time since it was written, then saves
// at once so a reload cannot credit the same absence twice. A slot whose save
// can't be read is never written over unasked: startup moves to an empty slot,
// or runs unsaved when there is none. `main.ts` only wires the renderer, HUD,
// input and loop around this.

import { newGame } from './sim/create';
import { SimIndex } from './sim/index';
import { applyOffline } from './sim/offline';
import {
  activeSlot,
  clearSlot,
  firstEmptySlot,
  migrateLegacy,
  readSlot,
  type SaveRecord,
  setActiveSlot,
  slotStatus,
  writeSlot,
} from './sim/save';
import type { GameState } from './sim/types';
import type { SettingsStore } from './settings';

/** Save-slot actions the gear menu drives. */
export interface SaveActions {
  active(): number;
  current(): GameState;
  /** False while the running game sits on a slot holding an unreadable save, which it must not overwrite. */
  saving(): boolean;
  saveNow(): void;
  load(slot: number): void;
  newGame(slot: number): void;
  importTo(slot: number, record: SaveRecord): void;
  remove(slot: number): void;
}

/** Longest an autosave waits for an idle moment before it runs anyway. */
const IDLE_TIMEOUT_MS = 2000;

export interface GameSessionHooks {
  /** The running game was swapped for a different one (load, new game, restart). */
  onSwitch?(): void;
}

export class GameSession implements SaveActions {
  private running: GameState;
  private slot: number;
  /** True while the running game must not be written: its slot holds a save this build can't read. */
  private unsaved = false;
  /** True once a failed write has been reported; cleared by the next successful one. */
  private writeWarned = false;
  private autosaveTimer = 0;
  /** The interval the timer runs at, or null while stopped. */
  private armedSec: number | null = null;
  /** Cancels the autosave waiting for an idle moment, or null when none is queued. */
  private cancelIdle: (() => void) | null = null;
  private detach: (() => void) | null = null;
  /** True after the loop hit an error: the running game may be broken, so it must not overwrite its slot. */
  private suspended = false;
  /** Per-session derived state for the running game; never serialized. */
  readonly sim = new SimIndex();

  constructor(
    private readonly settings: SettingsStore,
    private readonly hooks: GameSessionHooks = {},
  ) {
    migrateLegacy();
    this.slot = activeSlot();
    const st = slotStatus(this.slot);
    const rec = st.kind === 'ok' ? st.record : null;
    this.running = rec?.state ?? newGame();
    if (st.kind === 'unreadable') this.avoidUnreadable(st.reason);
    if (this.running.run.time > 0) this.logLoaded(this.slot);
    if (rec) this.creditOffline(rec.savedAt);
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

  /** True while saves of the running game are suspended (see `suspendAutosave`). */
  get autosaveSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Stop every save of the running game (interval, idle, page hide and Save now) so a game left broken by an
   * error cannot overwrite the last good save. Loading another slot or starting a new game resumes saving.
   */
  suspendAutosave(): void {
    this.suspended = true;
    this.cancelIdle?.();
    this.cancelIdle = null;
  }

  /** False while the running game is kept unsaved because its slot holds an unreadable save. */
  saving(): boolean {
    return !this.unsaved;
  }

  /** Save now, with the notice the menu shows. */
  saveNow(): void {
    if (this.suspended) {
      this.state.out.log.push({ level: 'warn', text: 'Saving is off after an error; export the save instead.' });
      return;
    }
    if (this.unsaved) {
      this.warnUnsaved();
      return;
    }
    if (this.persist()) this.state.out.log.push({ level: 'info', text: `Saved to slot ${this.slot + 1}.` });
  }

  /** Switch to the save in slot `i`, saving the running game first. */
  load(i: number): void {
    const rec = readSlot(i);
    if (!rec) return;
    this.switchTo(i, rec.state);
    this.logLoaded(i);
    this.creditOffline(rec.savedAt);
  }

  /** Start a brand-new game in slot `i`. */
  newGame(i: number): void {
    // Save the old game unless this restarts its own slot, which the new game
    // overwrites anyway.
    if (i === this.slot) clearSlot(i);
    else this.persist(); // a no-op while unsaved, so an unreadable slot is kept
    this.adopt(i);
  }

  /** Copy an imported record into slot `i`; the running game is untouched. */
  importTo(i: number, rec: SaveRecord): void {
    // The unsaved running game sits on slot `i`; replacing that save would leave it with nowhere to go.
    if (this.unsaved && i === this.slot) return;
    if (writeSlot(i, rec.state))
      this.state.out.log.push({ level: 'info', text: `Imported a save into slot ${i + 1}.` });
    else this.warnWriteFailed(i);
  }

  /**
   * Delete slot `i`, unless it holds the running game. Deleting the unreadable save the unsaved running game sits
   * on is allowed, and lets the running game save there from then on.
   */
  remove(i: number): void {
    if (i !== this.slot) clearSlot(i);
    else if (this.unsaved) {
      clearSlot(i);
      this.unsaved = false;
      this.persist();
    }
  }

  /** Autosave on the interval, plus a save when the tab is hidden or closed. Idempotent. */
  start(): void {
    if (this.armedSec !== null) return;
    this.armAutosave();
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const persist = (): void => {
      this.persist();
    };
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
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.detach?.();
    this.detach = null;
  }

  /** Swap the running game, saving the old one to its slot and the new one to its. */
  private switchTo(next: number, nextState: GameState): void {
    this.persist();
    this.adopt(next, nextState);
  }

  /** Swap in `state` (a fresh game by default) as slot `i`, and persist it. */
  private adopt(i: number, state: GameState = newGame()): void {
    this.slot = i;
    this.unsaved = false;
    setActiveSlot(i);
    this.running = state;
    this.suspended = false;
    this.clearIndex();
    this.hooks.onSwitch?.();
    this.persist();
  }

  /** Drop the previous run's derived structures so its rocks/ships can be collected. */
  private clearIndex(): void {
    this.sim.clear();
  }

  /** (Re)start the autosave timer from the current settings. */
  private armAutosave(): void {
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = 0;
    const sec = this.settings.value.autosaveSec;
    this.armedSec = sec;
    if (sec > 0) this.autosaveTimer = setInterval(() => this.persistWhenIdle(), sec * 1000);
  }

  /** Queue a save for the browser's next idle moment, so it lands between frames rather than inside one. */
  private persistWhenIdle(): void {
    if (this.cancelIdle) return;
    const run = (): void => {
      this.cancelIdle = null;
      this.persist();
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      this.cancelIdle = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(run, 0);
      this.cancelIdle = () => clearTimeout(id);
    }
  }

  /**
   * Write the running game to its slot, silently unless the write fails. A queued idle save is now redundant.
   * Does nothing while unsaved or suspended after an error. True when the game was written.
   */
  private persist(): boolean {
    this.cancelIdle?.();
    this.cancelIdle = null;
    if (this.unsaved || this.suspended) return false;
    if (writeSlot(this.slot, this.state)) {
      this.writeWarned = false;
      return true;
    }
    if (!this.writeWarned) this.warnWriteFailed(this.slot);
    this.writeWarned = true;
    return false;
  }

  /**
   * The active slot holds a save this build can't read. Start the fresh game in the first empty slot, or, with
   * none free, keep it unsaved so the stored text survives for export or a newer build.
   */
  private avoidUnreadable(reason: string): void {
    const bad = this.slot + 1;
    const free = firstEmptySlot();
    if (free >= 0) {
      this.slot = free;
      setActiveSlot(free);
      this.state.out.log.push({
        level: 'warn',
        text: `Slot ${bad} couldn't be loaded: ${reason} It is kept untouched; this new game is in slot ${free + 1}.`,
      });
    } else {
      this.unsaved = true;
      this.warnUnsaved(reason);
    }
  }

  private warnUnsaved(reason?: string): void {
    this.state.out.log.push({
      level: 'warn',
      text: `Not saving: slot ${this.slot + 1} holds a save this build can't load.${reason ? ` ${reason}` : ''} Export or delete it in Saves to save this game.`,
    });
  }

  private warnWriteFailed(i: number): void {
    this.state.out.log.push({
      level: 'warn',
      text: `Couldn't save to slot ${i + 1}: browser storage is full or blocked. Export your save to keep a copy.`,
    });
  }

  /** Credits the fleet's income since `savedAt` (if the setting allows) and saves, so it is credited once. */
  private creditOffline(savedAt: number): void {
    if (!this.settings.value.offlineProgress) return;
    if (applyOffline(this.state, (Date.now() - savedAt) / 1000)) this.persist();
  }

  private logLoaded(i: number): void {
    this.state.out.log.push({
      level: 'major',
      text: `Slot ${i + 1} loaded: system ${this.state.run.system.number}, ${this.state.run.system.name}.`,
    });
  }
}

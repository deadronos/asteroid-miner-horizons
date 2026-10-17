// Bootstrap: load or create a game, wire renderer + HUD + input, and run a
// fixed-step simulation (60 Hz) decoupled from the render frame rate.

import './style.css';
import { TUNING } from './data/tuning';
import { Input } from './input';
import { Renderer } from './render/Renderer';
import type { Command } from './sim/commands';
import { newGame } from './sim/create';
import { activeSlot, clearSlot, migrateLegacy, readSlot, setActiveSlot, writeSlot } from './sim/save';
import type { GameState } from './sim/types';
import { applyCommands, tick, type Assists } from './sim/update';
import { SettingsStore } from './settings';
import { Hud } from './ui/Hud';

const settings = new SettingsStore();
const app = document.getElementById('app')!;
const sceneEl = document.createElement('div');
sceneEl.id = 'scene';
app.append(sceneEl);

migrateLegacy();
let slot = activeSlot();
let state: GameState = readSlot(slot)?.state ?? newGame();
if (state.run.time > 0) state.out.log.push({ level: 'major', text: `Slot ${slot + 1} loaded: system ${state.run.system.number}, ${state.run.system.name}.` });

const commands: Command[] = [];
const send = (c: Command): void => void commands.push(c);

const renderer = new Renderer(sceneEl, settings.value);
const saveNow = (): void => writeSlot(slot, state);

/** Swap the running game (and the slot it autosaves to). */
function switchTo(next: number, nextState: GameState): void {
  saveNow();
  slot = next;
  setActiveSlot(slot);
  state = nextState;
  commands.length = 0;
  renderer.follow = true;
  saveNow();
}

const hud = new Hud(app, () => state, {
  send,
  saves: {
    active: () => slot,
    current: () => state,
    saveNow: () => {
      saveNow();
      state.out.log.push({ level: 'info', text: `Saved to slot ${slot + 1}.` });
    },
    load: (i) => {
      const rec = readSlot(i);
      if (!rec) return;
      switchTo(i, rec.state);
      state.out.log.push({ level: 'major', text: `Slot ${i + 1} loaded: system ${state.run.system.number}, ${state.run.system.name}.` });
    },
    newGame: (i) => {
      // Restarting the running slot must not first re-save the old game over it.
      if (i === slot) clearSlot(i);
      else saveNow();
      slot = i;
      setActiveSlot(i);
      state = newGame();
      commands.length = 0;
      renderer.follow = true;
      saveNow();
    },
    importTo: (i, rec) => {
      writeSlot(i, rec.state);
      state.out.log.push({ level: 'info', text: `Imported a save into slot ${i + 1}.` });
    },
    remove: (i) => {
      if (i !== slot) clearSlot(i);
    },
  },
}, settings);
let manualPause = false;
const input = new Input(renderer, hud, () => state, send, settings, () => (manualPause = !manualPause));

// Persistence: autosave on the chosen interval, plus on tab hide / close.
let autosaveTimer = 0;
function armAutosave(): void {
  clearInterval(autosaveTimer);
  const sec = settings.value.autosaveSec;
  if (sec > 0) autosaveTimer = window.setInterval(saveNow, sec * 1000);
}
armAutosave();
document.addEventListener('visibilitychange', () => document.hidden && saveNow());
window.addEventListener('beforeunload', saveNow);

let assists: Assists = { avoid: true, autoDock: true, chain: true };
function applySettings(): void {
  const s = settings.value;
  assists = { avoid: s.assistAvoid, autoDock: s.assistAutoDock, chain: s.assistChain };
  renderer.applySettings(s);
  armAutosave();
}
settings.onChange(applySettings);
applySettings();

/** Why the sim is paused right now, or null if it's running. */
function pauseReason(): string | null {
  const s = settings.value;
  if (manualPause) return 'PAUSED: press P to resume';
  if (s.pauseInMenus && (hud.menu.open || hud.researchOpen)) return 'PAUSED: menu open';
  if (s.pauseUnfocused && !document.hasFocus()) return 'PAUSED: window not focused';
  return null;
}

const STEP = 1 / TUNING.simHz;
let last = performance.now();
let acc = 0;
let hudAcc = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const paused = pauseReason();
  hud.setPaused(paused);
  if (paused) {
    // Menus still work while paused: purchases and refits apply immediately.
    acc = 0;
    applyCommands(state, commands);
  } else {
    acc += dt;
    const thrust = input.thrust();
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      tick(state, STEP, { thrust, commands, assists });
      acc -= STEP;
      steps++;
    }
    if (steps === 8) acc = 0; // too far behind (tab was hidden): drop the backlog
  }
  input.edgePan(dt);
  input.updateHover();
  renderer.render(state, dt, input.moveMark);
  hud.frame(dt);
  hudAcc += dt;
  if (hudAcc >= 0.1) {
    hudAcc = 0;
    hud.refresh(renderer.flash);
  }
  requestAnimationFrame(frame);
}
hud.refresh(0);
requestAnimationFrame(frame);

// Debug hook for automated checks in the browser console.
Object.assign(window, { __amh: { state: () => state, send, settings } });

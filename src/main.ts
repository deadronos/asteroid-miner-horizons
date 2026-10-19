// Bootstrap: load or create a game, wire renderer + HUD + input, and run a
// fixed-step simulation (60 Hz) decoupled from the render frame rate.

import './style.css';
import { AudioEngine } from './audio/AudioEngine';
import { TUNING } from './data/tuning';
import { Input } from './input';
import { pauseAudio, pauseBanner, pauseKind } from './pause';
import { Renderer } from './render/Renderer';
import { GameSession } from './session';
import type { HazardLevel } from './data/hazards';
import type { Assists } from './sim/assists';
import type { Command } from './sim/commands';
import { applyCommands, tick } from './sim/update';
import { SettingsStore } from './settings';
import { Hud } from './ui/Hud';

const settings = new SettingsStore();
const app = document.getElementById('app')!;
const sceneEl = document.createElement('div');
sceneEl.id = 'scene';
app.append(sceneEl);

const commands: Command[] = [];
const send = (c: Command): void => void commands.push(c);

const renderer = new Renderer(sceneEl, settings.value);
const audio = new AudioEngine(settings);
// Every enabled button clicks; disabled ones never fire `click`.
app.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest?.('button')) audio.ui('uiClick');
});

// The session owns the running game and its save slot. Switching games drops
// any queued command and re-centres the camera on the new flagship.
const session = new GameSession(settings, {
  onSwitch: () => {
    commands.length = 0;
    renderer.follow = true;
  },
});

const hud = new Hud(app, () => session.state, { send, saves: session }, settings);
renderer.labelBlockers = () => hud.blockerRects();
let manualPause = false;
const input = new Input(
  renderer,
  hud,
  () => session.state,
  send,
  settings,
  () => (manualPause = !manualPause),
);

let assists: Assists = { avoid: true, autoDock: true, chain: true };
let hazards: HazardLevel = 'normal';
function applySettings(): void {
  const s = settings.value;
  assists = { avoid: s.assistAvoid, autoDock: s.assistAutoDock, chain: s.assistChain };
  hazards = s.hazards;
  renderer.applySettings(s);
}
settings.onChange(applySettings);
applySettings();

// Autosave on the chosen interval (re-armed when it changes), plus a save on
// tab hide / close.
session.start();

const STEP = 1 / TUNING.simHz;
let last = performance.now();
let acc = 0;
let hudAcc = 0;

function frame(now: number): void {
  const state = session.state;
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const s = settings.value;
  const paused = pauseKind({
    manual: manualPause,
    pauseInMenus: s.pauseInMenus,
    pauseUnfocused: s.pauseUnfocused,
    menuOpen: hud.menu.open,
    researchOpen: hud.researchOpen,
    focused: document.hasFocus(),
  });
  hud.setPaused(pauseBanner(paused));
  if (paused) {
    // Menus still work while paused: purchases and refits apply immediately.
    acc = 0;
    applyCommands(state, commands);
  } else {
    acc += dt;
    const thrust = input.thrust();
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      tick(state, STEP, { thrust, commands, assists, hazards }, session.sim);
      acc -= STEP;
      steps++;
    }
    if (steps === 8) acc = 0; // too far behind (tab was hidden): drop the backlog
  }
  input.edgePan(dt);
  input.updateHover();
  audio.consumeFx(state.out.fx, renderer.view);
  audio.updateContinuous(state, renderer.view, pauseAudio(paused));
  audio.updateMusic(state);
  renderer.render(state, dt, input.moveMark);
  hud.frame(dt, renderer.flash);
  hudAcc += dt;
  if (hudAcc >= 0.1) {
    hudAcc = 0;
    audio.consumeLog(state.out.log);
    hud.refresh();
  }
  requestAnimationFrame(frame);
}
hud.refresh();
requestAnimationFrame(frame);

// Debug hook for automated checks in the browser console.
Object.assign(window, {
  __amh: { state: () => session.state, send, settings, renderer, audio, info: () => renderer.info },
});

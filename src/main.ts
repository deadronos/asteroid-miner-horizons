// Bootstrap: load or create a game, wire renderer + HUD + input, and run a
// fixed-step simulation (60 Hz) decoupled from the render frame rate.

import './style.css';
import { AudioEngine } from './audio/AudioEngine';
import { TUNING } from './data/tuning';
import { installDebugHook } from './debugHook';
import { Input } from './input';
import { pauseAudio, pauseBanner, pauseKind, renderDue } from './pause';
import { recordLoss } from './reloadGuard';
import { AutoQuality } from './render/autoQuality';
import { Renderer } from './render/Renderer';
import { GameSession } from './session';
import type { HazardLevel } from './data/hazards';
import type { Assists, FleetAuto } from './sim/assists';
import type { Command } from './sim/commands';
import { safeStorage } from './sim/save';
import { applyCommands, tick } from './sim/update';
import { SettingsStore } from './settings';
import { Hud } from './ui/Hud';
import { TitleScreen } from './ui/TitleScreen';

const settings = new SettingsStore();
const autoQuality = new AutoQuality();
const app = document.getElementById('app')!;
const sceneEl = document.createElement('div');
sceneEl.id = 'scene';
app.append(sceneEl);

const commands: Command[] = [];
const send = (c: Command): void => void commands.push(c);

const renderer = new Renderer(sceneEl, settings.value);
const reducedMotion =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const applyReducedMotion = () => renderer.setReducedMotion(!!reducedMotion?.matches);
if (reducedMotion) {
  if (typeof reducedMotion.addEventListener === 'function')
    reducedMotion.addEventListener('change', applyReducedMotion);
  else reducedMotion.addListener(applyReducedMotion);
}
applyReducedMotion();
const audio = new AudioEngine(settings);
// Every enabled button clicks; disabled ones never fire `click`.
app.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest?.('button')) audio.ui('uiClick');
});

// The session owns the running game and its save slot. Switching games drops
// any queued command, re-centres the camera on the new flagship and lifts a
// loop-error stop (the new game has not failed).
const session = new GameSession(settings, {
  onSwitch: () => {
    commands.length = 0;
    renderer.follow = true;
    renderNow = true;
    if (crashed) {
      crashed = false;
      hud.clearNotice();
    }
  },
});

const hud = new Hud(app, () => session.state, { send, saves: session }, settings);
renderer.labelBlockers = () => hud.blockerRects();
const title = new TitleScreen(session, settings, {
  openSettings: () => hud.menu.toggle(),
  onDismiss: () => session.start(),
});
let manualPause = false;
const input = new Input(
  renderer,
  hud,
  () => session.state,
  send,
  settings,
  () => (manualPause = !manualPause),
  () => title.open,
);

let assists: Assists = { avoid: true, autoDock: true, chain: true };
let hazards: HazardLevel = 'normal';
let automation: FleetAuto = { repairAt: 0.5, reserve: 100 };
let qualityMode = settings.value.quality;
function applySettings(): void {
  const s = settings.value;
  if (qualityMode !== s.quality) {
    qualityMode = s.quality;
    autoQuality.reset();
  }
  assists = { avoid: s.assistAvoid, autoDock: s.assistAutoDock, chain: s.assistChain };
  automation = { repairAt: s.autoRepairAt, reserve: s.autoReserve };
  hazards = s.hazards;
  renderer.applySettings(s, autoQuality.level);
}
settings.onChange(applySettings);
applySettings();

const STEP = 1 / TUNING.simHz;
let last = performance.now();
let acc = 0;
let hudAcc = 0;
/** Frame time since the last render, handed to the renderer so throttled animations keep their speed. */
let renderAcc = 0;
/** Forces the next frame to render even while paused (a game was loaded or a command applied). */
let renderNow = true;
/** When the player last touched the mouse, wheel or keyboard; a paused scene renders every frame shortly after. */
let lastInput = -Infinity;
/** Seconds after input during which a paused scene still renders at the full frame rate. */
const INPUT_GRACE = 0.5;
for (const type of ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup'] as const)
  window.addEventListener(type, () => (lastInput = performance.now()), { capture: true, passive: true });
let contextLost = false;
/** Set when a frame threw: the running game may be half-ticked, so it stops ticking and saving until another loads. */
let crashed = false;

/** Stops the sim after an error and offers a way out; the loop keeps running so the menus still work. */
function onLoopError(err: unknown): void {
  if (crashed) return;
  crashed = true;
  console.error(err);
  session.suspendAutosave();
  const msg = err instanceof Error ? err.message : String(err);
  hud.showNotice(
    `The game hit an error and stopped (${msg}). Saving is off, so slot ${session.active() + 1} keeps its last save.`,
    [
      { label: 'Reload', onClick: () => location.reload() },
      { label: 'Export save', onClick: () => hud.menu.openSaves() },
    ],
  );
}

function frame(now: number): void {
  // Lost context: stop ticking and stop scheduling frames; the reload follows.
  if (contextLost) return;
  try {
    step(now);
  } catch (err) {
    onLoopError(err);
  }
  requestAnimationFrame(frame);
}

function step(now: number): void {
  const state = session.state;
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const s = settings.value;
  const paused = title.open
    ? 'manual'
    : pauseKind({
        manual: manualPause,
        pauseInMenus: s.pauseInMenus,
        pauseUnfocused: s.pauseUnfocused,
        menuOpen: hud.menu.open,
        researchOpen: hud.researchOpen,
        warpOpen: hud.warpOpen,
        focused: document.hasFocus(),
      });
  hud.setPaused(title.open ? null : pauseBanner(paused));
  if (crashed) {
    // Nothing more may change the broken game; only loading another (via the menu) recovers.
    acc = 0;
    commands.length = 0;
  } else if (paused) {
    // Menus still work while paused: purchases and refits apply immediately.
    acc = 0;
    if (commands.length) renderNow = true;
    applyCommands(state, commands);
  } else {
    acc += dt;
    const thrust = input.thrust();
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      tick(state, STEP, { thrust, commands, assists, automation, hazards }, session.sim);
      acc -= STEP;
      steps++;
    }
    if (steps === 8) acc = 0; // too far behind (tab was hidden): drop the backlog
  }
  if (input.edgePan(dt)) renderNow = true;
  input.updateHover();
  audio.consumeFx(state.out.fx, renderer.view);
  audio.updateContinuous(state, renderer.view, pauseAudio(paused));
  audio.updateMusic(state);
  // A frozen scene is nearly static, so a paused loop renders at a reduced rate unless something is moving:
  // recent input, a camera glide or warp still playing, or fx waiting to be consumed (the renderer clears them).
  renderAcc += dt;
  const busy = renderNow || renderer.busy || state.out.fx.length > 0 || (now - lastInput) / 1000 < INPUT_GRACE;
  if (renderDue(paused, renderAcc, busy)) {
    renderer.render(state, Math.min(0.25, renderAcc), input.moveMark);
    if (s.quality === 'auto' && !paused) {
      const level = autoQuality.update(dt * 1000);
      if (level !== null) renderer.applySettings(s, level);
    }
    renderAcc = 0;
    renderNow = false;
  }
  hud.frame(dt, renderer.flash);
  hudAcc += dt;
  if (hudAcc >= 0.1) {
    hudAcc = 0;
    audio.consumeLog(state.out.log);
    hud.refresh();
    hud.touch.sync(renderer.follow, manualPause);
  }
}
// A lost WebGL context leaves a black canvas: save, then reload into the same game. A GPU that keeps
// resetting would reload forever, so after too many losses in a short window the page stays up instead.
renderer.onContextLost = () => {
  contextLost = true;
  // The title screen freezes the sim, so the boot game must not be written; dismissal starts autosave.
  if (!title.open) session.saveNow();
  if (!recordLoss(safeStorage('sessionStorage'), Date.now())) {
    hud.showNotice('Graphics keep resetting — try lowering quality or disabling anti-aliasing, then reload', {
      label: 'Reload',
      onClick: () => location.reload(),
    });
    return;
  }
  hud.showNotice('Graphics reset — reloading…');
  setTimeout(() => location.reload(), 1500);
};
hud.refresh();
requestAnimationFrame(frame);

// Debug hook for console poking and browser tests. Off on a plain production load; see debugHook.ts.
installDebugHook(
  window,
  { dev: import.meta.env.DEV, search: location.search, storage: safeStorage('localStorage') },
  {
    state: () => session.state,
    send,
    settings,
    renderer,
    input,
    audio,
    autoQuality,
    info: () => renderer.info,
    title,
  },
);

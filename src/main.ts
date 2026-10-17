// Bootstrap: input, fixed-step sim, render, UI refresh.
import { TUNING } from './config';
import { Renderer } from './render';
import { UI } from './ui';
import {
  createGame,
  orderMine,
  orderMove,
  type GameState,
  type KeyInput,
} from './world';

const app = document.getElementById('app')!;
const ui = new UI(app);
const renderer = new Renderer(ui.sceneContainer);
let state: GameState = createGame();

// --- Keyboard ---
const held = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  held.add(e.code);
  if (e.code === 'Tab') {
    e.preventDefault();
    cycleShip(1);
  }
  if (e.code === 'Escape') {
    const sel = state.ships.find((s) => s.id === state.selectedId);
    if (sel) {
      sel.moveTarget = null;
      sel.miningTargetId = null;
    }
  }
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function cycleShip(dir: 1 | -1): void {
  const alive = state.ships.filter((s) => s.alive);
  if (alive.length === 0) return;
  const i = alive.findIndex((s) => s.id === state.selectedId);
  const next = alive[(i + dir + alive.length) % alive.length]!;
  state.selectedId = next.id;
}

function readKeys(): KeyInput {
  let x = 0;
  let z = 0;
  if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1;
  if (held.has('KeyD') || held.has('ArrowRight')) x += 1;
  if (held.has('KeyW') || held.has('ArrowUp')) z -= 1;
  if (held.has('KeyS') || held.has('ArrowDown')) z += 1;
  return { x, z };
}

// --- Mouse: click ship = select, click rock = mine, click space = move ---
const canvas = ui.sceneContainer.querySelector('canvas')!;
let downAt = 0;
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  // Treat as click only (ignore drags).
  if (performance.now() - downAt > 400) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const hit = renderer.pick(nx, ny);
  const selId = state.selectedId;
  if (hit?.kind === 'ship') {
    state.selectedId = hit.id;
    return;
  }
  if (hit?.kind === 'asteroid') {
    const sel = state.ships.find((s) => s.id === selId);
    if (sel?.alive) orderMine(state, sel.id, hit.id);
    return;
  }
  const w = renderer.screenToWorld(e.clientX, e.clientY);
  const sel = state.ships.find((s) => s.id === selId);
  if (sel?.alive) orderMove(state, sel.id, w);
});

// --- Main loop: fixed-step sim, render every frame ---
import { update } from './world';

let last = performance.now();
let acc = 0;
let uiAcc = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  let steps = 0;
  while (acc >= TUNING.simStep && steps < 8) {
    update(state, TUNING.simStep, readKeys());
    acc -= TUNING.simStep;
    steps++;
  }
  const sel = state.ships.find((s) => s.id === state.selectedId);
  renderer.sync(state, dt, sel?.moveTarget && !sel.miningTargetId ? sel.moveTarget : null);
  uiAcc += dt;
  if (uiAcc > 0.2) {
    uiAcc = 0;
    ui.refresh(state);
  }
  requestAnimationFrame(frame);
}

ui.refresh(state);
requestAnimationFrame(frame);

// Debug/testing hook (used by automated smoke checks, harmless in prod).
(window as unknown as { __amh: unknown }).__amh = {
  state: () => state,
  orderMine,
  orderMove,
  step: (dt: number) => update(state, dt, { x: 0, z: 0 }),
};

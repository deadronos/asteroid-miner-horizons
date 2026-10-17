// Simulation: procedural star systems, ships, asteroids, mining, fleet AI, warp.
// Pure 2D logic on the { x, z } plane — rendering lives in render.ts.

import { COMPONENTS, TUNING, type SlotKey, type Vec2 } from './config';

export type AsteroidSize = 'large' | 'medium' | 'small' | 'chunk';
export type PickupKind = 'ore' | 'ice';

export interface Asteroid {
  id: number;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  size: AsteroidSize;
  hp: number;
  maxHp: number;
  ore: number;
  ice: number;
  icy: boolean;
  spin: number;
  seed: number;
}

export interface Pickup {
  id: number;
  pos: Vec2;
  vel: Vec2;
  kind: PickupKind;
  amount: number;
}

export interface Ship {
  id: number;
  name: string;
  drone: boolean;
  pos: Vec2;
  vel: Vec2;
  angle: number;
  hull: number;
  maxHull: number;
  shield: number;
  slots: Record<SlotKey, number>;
  moveTarget: Vec2 | null;
  miningTargetId: number | null;
  beamOn: boolean;
  collisionCd: number;
  alive: boolean;
}

export interface Moon {
  orbitRadius: number;
  radius: number;
  angle: number;
  speed: number;
  color: number;
}

export interface Planet {
  orbitRadius: number;
  radius: number;
  angle: number;
  speed: number;
  color: number;
  moons: Moon[];
}

export interface GameState {
  seed: number;
  systemIndex: number;
  prestige: number; // completed warps
  time: number;
  starRadius: number;
  planets: Planet[];
  ships: Ship[];
  asteroids: Asteroid[];
  pickups: Pickup[];
  cargo: { ore: number; ice: number };
  selectedId: number;
  events: string[];
}

export interface ShipStats {
  speed: number;
  accel: number;
  dps: number;
  range: number;
  pickupRadius: number;
  shieldMax: number;
  shieldRegen: number;
  armorFactor: number; // damage multiplier, lower is better
}

const SIZE_INFO: Record<AsteroidSize, { rMin: number; rMax: number; hp: number }> = {
  large: { rMin: 26, rMax: 40, hp: 130 },
  medium: { rMin: 15, rMax: 25, hp: 60 },
  small: { rMin: 8, rMax: 14, hp: 24 },
  chunk: { rMin: 4, rMax: 7, hp: 9 },
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shipStats(ship: Ship, prestige: number): ShipStats {
  const s = ship.slots;
  const speedMul = (1 + 0.18 * s.engine) * (1 + TUNING.prestigeSpeedBonus * prestige);
  const armorFactor = Math.pow(0.92, s.armor);
  return {
    speed: TUNING.baseSpeed * speedMul,
    accel: TUNING.baseAccel * speedMul,
    dps: TUNING.baseLaserDps * (1 + 0.4 * s.laser),
    range: TUNING.baseLaserRange * (1 + 0.12 * s.laser),
    pickupRadius: TUNING.basePickupRadius + 25 * s.sensor,
    shieldMax: TUNING.shieldBase + 30 * s.shield,
    shieldRegen: TUNING.shieldRegenBase + 2 * s.shield,
    armorFactor,
  };
}

/** Damage that hits shields first, then hull. Returns actual hull damage taken. */
function damageShip(state: GameState, ship: Ship, raw: number): number {
  const st = shipStats(ship, state.prestige);
  const dmg = raw * st.armorFactor;
  let rest = dmg;
  if (ship.shield > 0) {
    const absorbed = Math.min(ship.shield, rest);
    ship.shield -= absorbed;
    rest -= absorbed;
  }
  ship.hull = Math.max(0, ship.hull - rest);
  if (ship.hull <= 0 && ship.alive) {
    ship.alive = false;
    ship.beamOn = false;
    state.events.push(`${ship.name} was destroyed!`);
  }
  return rest;
}

let nextId = 1;

function makeAsteroid(
  rnd: () => number,
  size: AsteroidSize,
  pos: Vec2,
  oreBias: number,
  yieldMul: number,
): Asteroid {
  const info = SIZE_INFO[size];
  const radius = info.rMin + rnd() * (info.rMax - info.rMin);
  const icy = rnd() > oreBias;
  const scale = radius / 20;
  const ore = Math.max(1, Math.round((icy ? 2 : 7) * scale * (0.7 + rnd() * 0.6) * yieldMul));
  const ice = Math.max(1, Math.round((icy ? 7 : 2) * scale * (0.7 + rnd() * 0.6) * yieldMul));
  return {
    id: nextId++,
    pos: { ...pos },
    vel: { x: (rnd() - 0.5) * 4, z: (rnd() - 0.5) * 4 },
    radius,
    size,
    hp: info.hp * (0.85 + rnd() * 0.3),
    maxHp: info.hp,
    ore,
    ice,
    icy,
    spin: (rnd() - 0.5) * 0.8,
    seed: Math.floor(rnd() * 1e9),
  };
}

function scatterBelt(
  state: GameState,
  rnd: () => number,
  inner: number,
  outer: number,
  count: number,
  oreBias: number,
): void {
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = inner + rnd() * (outer - inner);
    const roll = rnd();
    const size: AsteroidSize = roll < 0.12 ? 'large' : roll < 0.4 ? 'medium' : roll < 0.8 ? 'small' : 'chunk';
    state.asteroids.push(
      makeAsteroid(rnd, size, { x: Math.cos(a) * r, z: Math.sin(a) * r }, oreBias, 1 + TUNING.prestigeYieldBonus * state.prestige),
    );
  }
}

function makeShip(name: string, drone: boolean, pos: Vec2): Ship {
  return {
    id: nextId++,
    name,
    drone,
    pos: { ...pos },
    vel: { x: 0, z: 0 },
    angle: 0,
    hull: 100,
    maxHull: 100,
    shield: TUNING.shieldBase,
    slots: { engine: 0, laser: 0, shield: 0, armor: 0, sensor: 0 },
    moveTarget: null,
    miningTargetId: null,
    beamOn: false,
    collisionCd: 0,
    alive: true,
  };
}

export function createGame(): GameState {
  nextId = 1;
  const state: GameState = {
    seed: (Math.random() * 1e9) | 0,
    systemIndex: 1,
    prestige: 0,
    time: 0,
    starRadius: 70,
    planets: [],
    ships: [],
    asteroids: [],
    pickups: [],
    cargo: { ore: 30, ice: 15 },
    selectedId: -1,
    events: [],
  };
  generateSystem(state);
  const flagship = makeShip('Horizon-1', false, { x: 470, z: 40 });
  const drone = makeShip('Drone-2', true, { x: 430, z: -30 });
  state.ships.push(flagship, drone);
  state.selectedId = flagship.id;
  state.events.push('Horizon systems online. WASD / click to move, click a rock to mine.');
  state.events.push('Warp drive needs 40 ice. Mine the outer belt for ice.');
  return state;
}

export function generateSystem(state: GameState): void {
  const rnd = mulberry32(state.seed);
  state.asteroids = [];
  state.pickups = [];
  state.planets = [];
  const planetColors = [0x4d7dd1, 0xc96b3a, 0x7fc46b, 0xb49be0];
  const radii = [250, 520, 1010, 1620];
  for (let i = 0; i < 4; i++) {
    const moons: Moon[] = [];
    const moonCount = Math.floor(rnd() * 3);
    for (let m = 0; m < moonCount; m++) {
      moons.push({
        orbitRadius: 28 + rnd() * 30,
        radius: 4 + rnd() * 5,
        angle: rnd() * Math.PI * 2,
        speed: 0.25 + rnd() * 0.4,
        color: 0x9aa3b2,
      });
    }
    state.planets.push({
      orbitRadius: radii[i]! + (rnd() - 0.5) * 60,
      radius: 16 + rnd() * 22,
      angle: rnd() * Math.PI * 2,
      speed: 0.008 + rnd() * 0.012,
      color: planetColors[i]!,
      moons,
    });
  }
  scatterBelt(state, rnd, 620, 880, 150, 0.7); // inner: ore-rich
  scatterBelt(state, rnd, 1150, 1450, 110, 0.3); // outer: ice-rich
}

export function warpCost(state: GameState): number {
  return Math.round(TUNING.warpIceCost * (1 + 0.25 * state.prestige));
}

export function canWarp(state: GameState): boolean {
  return state.cargo.ice >= warpCost(state);
}

export function doWarp(state: GameState): boolean {
  if (!canWarp(state)) return false;
  state.cargo.ice -= warpCost(state);
  state.prestige += 1;
  state.systemIndex += 1;
  state.seed = (Math.random() * 1e9) | 0;
  generateSystem(state);
  for (const ship of state.ships) {
    if (!ship.alive) {
      ship.alive = true;
      ship.hull = ship.maxHull;
      ship.shield = shipStats(ship, state.prestige).shieldMax;
    }
    ship.pos = { x: 470 + (Math.random() - 0.5) * 80, z: (Math.random() - 0.5) * 160 };
    ship.vel = { x: 0, z: 0 };
    ship.moveTarget = null;
    ship.miningTargetId = null;
    ship.beamOn = false;
  }
  state.events.push(
    `Warp complete — System ${state.systemIndex}. Prestige +${Math.round(TUNING.prestigeYieldBonus * 100)}% yield.`,
  );
  return true;
}

export function selectedShip(state: GameState): Ship | undefined {
  return state.ships.find((s) => s.id === state.selectedId && s.alive);
}

export function orderMove(state: GameState, shipId: number, target: Vec2): void {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || !ship.alive) return;
  ship.moveTarget = { ...target };
  ship.miningTargetId = null;
  ship.beamOn = false;
}

export function orderMine(state: GameState, shipId: number, asteroidId: number): void {
  const ship = state.ships.find((s) => s.id === shipId);
  const rock = state.asteroids.find((a) => a.id === asteroidId);
  if (!ship || !ship.alive || !rock) return;
  ship.miningTargetId = asteroidId;
  ship.moveTarget = null;
}

function dropPickups(state: GameState, pos: Vec2, ore: number, ice: number): void {
  const total = ore + ice;
  if (total <= 0) return;
  // Split into a few drifting chunks so collection feels granular.
  const chunks = Math.min(6, 2 + Math.floor(total / 4));
  for (let i = 0; i < chunks; i++) {
    const isOre = i < Math.round((chunks * ore) / total);
    const amount = Math.max(1, Math.round(total / chunks));
    const a = Math.random() * Math.PI * 2;
    state.pickups.push({
      id: nextId++,
      pos: { x: pos.x + (Math.random() - 0.5) * 24, z: pos.z + (Math.random() - 0.5) * 24 },
      vel: { x: Math.cos(a) * (14 + Math.random() * 22), z: Math.sin(a) * (14 + Math.random() * 22) },
      kind: isOre ? 'ore' : 'ice',
      amount,
    });
  }
}

function crackAsteroid(state: GameState, rock: Asteroid): void {
  const rnd = Math.random;
  const spawn = (size: AsteroidSize, dx: number, dz: number) => {
    const frag = makeAsteroid(rnd, size, { x: rock.pos.x + dx, z: rock.pos.z + dz }, rock.icy ? 0.3 : 0.7, 1 + TUNING.prestigeYieldBonus * state.prestige);
    // Fragments inherit a share of the parent's remaining value.
    frag.ore = Math.max(1, Math.round(rock.ore / 3));
    frag.ice = Math.max(1, Math.round(rock.ice / 3));
    const a = rnd() * Math.PI * 2;
    frag.vel = { x: Math.cos(a) * 26, z: Math.sin(a) * 26 };
    state.asteroids.push(frag);
  };
  if (rock.size === 'large') {
    spawn('medium', -18, 6);
    spawn('medium', 16, -10);
    spawn('medium', 2, 18);
    dropPickups(state, rock.pos, Math.round(rock.ore / 2), Math.round(rock.ice / 2));
    state.events.push('Asteroid cracked into fragments.');
  } else if (rock.size === 'medium') {
    spawn('small', -10, 4);
    spawn('small', 10, -6);
    dropPickups(state, rock.pos, Math.round(rock.ore / 2), Math.round(rock.ice / 2));
  } else {
    dropPickups(state, rock.pos, rock.ore, rock.ice);
  }
}

function addCargo(state: GameState, kind: PickupKind, amount: number): number {
  const total = state.cargo.ore + state.cargo.ice;
  const room = Math.max(0, TUNING.cargoCap - total);
  const take = Math.min(room, amount);
  if (take > 0) state.cargo[kind] += take;
  return take;
}

const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
};

function steerShip(state: GameState, ship: Ship, st: ShipStats, dt: number, wishX: number, wishZ: number): void {
  ship.vel.x += wishX * st.accel * dt;
  ship.vel.z += wishZ * st.accel * dt;
  const sp = Math.hypot(ship.vel.x, ship.vel.z);
  if (sp > st.speed) {
    ship.vel.x = (ship.vel.x / sp) * st.speed;
    ship.vel.z = (ship.vel.z / sp) * st.speed;
  }
  // Mild drift so space feels slick but controllable.
  ship.vel.x *= 1 - Math.min(0.9, 1.6 * dt);
  ship.vel.z *= 1 - Math.min(0.9, 1.6 * dt);
  ship.pos.x += ship.vel.x * dt;
  ship.pos.z += ship.vel.z * dt;
  if (sp > 4) ship.angle = Math.atan2(ship.vel.z, ship.vel.x);
}

function updateShipMovement(
  state: GameState,
  ship: Ship,
  st: ShipStats,
  dt: number,
  keyX: number,
  keyZ: number,
  isSelected: boolean,
): void {
  ship.beamOn = false;
  // 1. Mining takes priority: close to range, otherwise fly there.
  const rock = ship.miningTargetId != null ? state.asteroids.find((a) => a.id === ship.miningTargetId) : undefined;
  if (rock) {
    const d = dist2(ship.pos, rock.pos);
    if (d <= st.range + rock.radius) {
      ship.beamOn = true;
      ship.vel.x *= 1 - Math.min(0.9, 4 * dt);
      ship.vel.z *= 1 - Math.min(0.9, 4 * dt);
      ship.angle = Math.atan2(rock.pos.z - ship.pos.z, rock.pos.x - ship.pos.x);
      rock.hp -= st.dps * dt;
      if (rock.hp <= 0) {
        state.asteroids = state.asteroids.filter((a) => a.id !== rock.id);
        crackAsteroid(state, rock);
        for (const s of state.ships) {
          if (s.miningTargetId === rock.id) {
            s.miningTargetId = null;
            s.beamOn = false;
          }
        }
      }
      return;
    }
    // Fly into range.
    const dx = rock.pos.x - ship.pos.x;
    const dz = rock.pos.z - ship.pos.z;
    const len = Math.max(1, Math.hypot(dx, dz));
    steerShip(state, ship, st, dt, dx / len, dz / len);
    return;
  }
  // 2. Direct key control (selected ship only).
  if (isSelected && (keyX !== 0 || keyZ !== 0)) {
    const len = Math.max(1, Math.hypot(keyX, keyZ));
    ship.moveTarget = null;
    steerShip(state, ship, st, dt, keyX / len, keyZ / len);
    return;
  }
  // 3. Click-to-move target with arrival slowdown.
  if (ship.moveTarget) {
    const dx = ship.moveTarget.x - ship.pos.x;
    const dz = ship.moveTarget.z - ship.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 14) {
      ship.moveTarget = null;
      return;
    }
    const slow = Math.min(1, d / 120);
    steerShip(state, ship, st, dt, (dx / d) * slow, (dz / d) * slow);
    return;
  }
  // 4. Idle drift.
  ship.pos.x += ship.vel.x * dt;
  ship.pos.z += ship.vel.z * dt;
  ship.vel.x *= 1 - Math.min(0.9, 2 * dt);
  ship.vel.z *= 1 - Math.min(0.9, 2 * dt);
}

function updateDrone(state: GameState, ship: Ship, st: ShipStats, dt: number): void {
  const flagship = state.ships.find((s) => !s.drone && s.alive);
  if (!flagship) {
    ship.beamOn = false;
    return;
  }
  // Assist the flagship's target when already in range.
  const flagshipTarget =
    flagship.miningTargetId != null ? state.asteroids.find((a) => a.id === flagship.miningTargetId) : undefined;
  if (flagshipTarget && dist2(ship.pos, flagshipTarget.pos) <= st.range + flagshipTarget.radius) {
    ship.miningTargetId = flagshipTarget.id;
  } else if (ship.miningTargetId == null) {
    // Find own work near the flagship.
    let best: Asteroid | undefined;
    let bestD = st.pickupRadius * 3 + 200;
    for (const a of state.asteroids) {
      const dShip = dist2(ship.pos, a.pos);
      const dFlag = dist2(flagship.pos, a.pos);
      if (dFlag < st.pickupRadius * 3 + 400 && dShip < bestD) {
        best = a;
        bestD = dShip;
      }
    }
    if (best) ship.miningTargetId = best.id;
  }
  const rock = ship.miningTargetId != null ? state.asteroids.find((a) => a.id === ship.miningTargetId) : undefined;
  if (rock) {
    updateShipMovement(state, ship, st, dt, 0, 0, false);
    return;
  }
  // Follow the flagship at an offset.
  const anchor = { x: flagship.pos.x - 70, z: flagship.pos.z + 55 };
  if (dist2(ship.pos, anchor) > 40) {
    const dx = anchor.x - ship.pos.x;
    const dz = anchor.z - ship.pos.z;
    const len = Math.max(1, Math.hypot(dx, dz));
    steerShip(state, ship, st, dt, dx / len, dz / len);
  } else {
    ship.pos.x += ship.vel.x * dt;
    ship.pos.z += ship.vel.z * dt;
  }
}

export interface KeyInput {
  x: number;
  z: number;
}

export function update(state: GameState, dt: number, keys: KeyInput): void {
  state.time += dt;
  // Planets + moons orbit.
  for (const p of state.planets) {
    p.angle += p.speed * dt;
    for (const m of p.moons) m.angle += m.speed * dt;
  }
  // Asteroid drift.
  for (const a of state.asteroids) {
    a.pos.x += a.vel.x * dt;
    a.pos.z += a.vel.z * dt;
    a.vel.x *= 1 - Math.min(0.9, 0.05 * dt);
    a.vel.z *= 1 - Math.min(0.9, 0.05 * dt);
  }
  // Ships.
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const st = shipStats(ship, state.prestige);
    ship.collisionCd = Math.max(0, ship.collisionCd - dt);
    if (ship.drone) {
      updateDrone(state, ship, st, dt);
    } else {
      const isSelected = ship.id === state.selectedId;
      updateShipMovement(state, ship, st, dt, isSelected ? keys.x : 0, isSelected ? keys.z : 0, isSelected);
    }
    // Collisions with asteroids.
    for (const a of state.asteroids) {
      const d = dist2(ship.pos, a.pos);
      if (d < a.radius + 10) {
        const nx = (ship.pos.x - a.pos.x) / Math.max(1, d);
        const nz = (ship.pos.z - a.pos.z) / Math.max(1, d);
        ship.pos.x = a.pos.x + nx * (a.radius + 11);
        ship.pos.z = a.pos.z + nz * (a.radius + 11);
        if (ship.collisionCd <= 0) {
          const impact = Math.min(30, Math.max(4, Math.hypot(ship.vel.x, ship.vel.z) * 0.15));
          const hullDmg = damageShip(state, ship, impact);
          if (hullDmg > 0.5) state.events.push(`${ship.name} hull impact (−${hullDmg.toFixed(0)}).`);
          ship.vel.x = nx * 40;
          ship.vel.z = nz * 40;
          ship.collisionCd = TUNING.collisionCooldown;
        }
      }
    }
    // Star heat.
    const dStar = Math.hypot(ship.pos.x, ship.pos.z);
    if (dStar < state.starRadius + TUNING.starHeatRadiusPad) {
      const before = ship.hull;
      damageShip(state, ship, TUNING.starHeatDps * dt * 2);
      if (ship.hull < before && Math.floor(state.time * 2) !== Math.floor((state.time - dt) * 2)) {
        state.events.push(`${ship.name} is taking heat damage near the star!`);
      }
    }
    // Shield regen.
    ship.shield = Math.min(st.shieldMax, ship.shield + st.shieldRegen * dt);
  }
  // Pickups drift + magnet collection.
  const aliveShips = state.ships.filter((s) => s.alive);
  const kept: Pickup[] = [];
  for (const p of state.pickups) {
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    p.vel.x *= 1 - Math.min(0.9, 0.6 * dt);
    p.vel.z *= 1 - Math.min(0.9, 0.6 * dt);
    let best: Ship | undefined;
    let bestD = Infinity;
    for (const s of aliveShips) {
      const st = shipStats(s, state.prestige);
      const d = dist2(s.pos, p.pos);
      if (d < st.pickupRadius && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (best) {
      // Tractor in.
      const dx = best.pos.x - p.pos.x;
      const dz = best.pos.z - p.pos.z;
      const len = Math.max(1, Math.hypot(dx, dz));
      const pull = 420 * dt;
      p.pos.x += (dx / len) * pull;
      p.pos.z += (dz / len) * pull;
      if (bestD < TUNING.collectRadius) {
        const took = addCargo(state, p.kind, p.amount);
        if (took >= p.amount) continue; // fully collected
        p.amount -= took; // cargo full: leave the rest
      }
    }
    kept.push(p);
  }
  state.pickups = kept;
}

export function upgradeCost(ship: Ship, key: SlotKey): number | null {
  const def = COMPONENTS[key];
  const lvl = ship.slots[key];
  if (lvl >= def.maxLevel) return null;
  return def.cost(lvl);
}

export function buyUpgrade(state: GameState, shipId: number, key: SlotKey): boolean {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return false;
  const cost = upgradeCost(ship, key);
  if (cost == null || state.cargo.ore < cost) return false;
  state.cargo.ore -= cost;
  ship.slots[key] += 1;
  state.events.push(`${ship.name}: ${COMPONENTS[key].name} → Lv${ship.slots[key]}.`);
  return true;
}

export function repairCost(ship: Ship): number {
  return Math.ceil((ship.maxHull - ship.hull) * TUNING.repairOrePerHull);
}

export function repairShip(state: GameState, shipId: number): boolean {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return false;
  const cost = repairCost(ship);
  if (cost <= 0) return true;
  if (state.cargo.ore < cost) return false;
  state.cargo.ore -= cost;
  ship.hull = ship.maxHull;
  state.events.push(`${ship.name} repaired to full hull.`);
  return true;
}

export function buyDrone(state: GameState): boolean {
  const alive = state.ships.filter((s) => s.alive).length;
  if (alive >= TUNING.maxFleet) return false;
  if (state.cargo.ore < TUNING.droneOreCost || state.cargo.ice < TUNING.droneIceCost) return false;
  state.cargo.ore -= TUNING.droneOreCost;
  state.cargo.ice -= TUNING.droneIceCost;
  const flagship = state.ships[0];
  const drone = makeShip(`Drone-${state.ships.length + 1}`, true, {
    x: (flagship?.pos.x ?? 470) - 60,
    z: (flagship?.pos.z ?? 40) + 60,
  });
  state.ships.push(drone);
  state.events.push(`${drone.name} joined the fleet.`);
  return true;
}

export function drainEvents(state: GameState): string[] {
  const out = state.events.slice(-30);
  state.events = [];
  return out;
}

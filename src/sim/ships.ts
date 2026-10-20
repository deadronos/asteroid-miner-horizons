// Ship construction, derived stats and damage.

import { removeItem } from '../core/array';
import { v, type Vec2 } from '../core/vec';
import { variantDef, type ShipStatKey } from '../data/components';
import { HULLS, type HullId } from '../data/hulls';
import { emptyWallet, walletTotal } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { GameState, Profile, Run, Ship } from './types';

/** Derived stats; the key list lives with the component effects that target it. */
export type ShipStats = Record<ShipStatKey, number>;

/** A `ShipStats` with every key at 0, ready to be overwritten by `writeShipStats`. */
export function emptyStats(): ShipStats {
  return {
    maxHull: 0,
    maxShield: 0,
    shieldRegen: 0,
    speed: 0,
    accel: 0,
    dps: 0,
    range: 0,
    magnet: 0,
    cargoCap: 0,
    dmgMul: 0,
    size: 0,
    splash: 0,
    laserTier: 0,
  };
}

/**
 * Writes `ship`'s derived stats into `out` and returns it. Overwrites **every**
 * `ShipStatKey`, so a reused object cannot keep a stale value (and a later
 * `magnet *=` in `applyEffects` cannot compound across ticks).
 */
export function writeShipStats(out: ShipStats, ship: Ship, profile: Profile): ShipStats {
  const h = HULLS[ship.hullId];
  out.maxHull = h.hull;
  out.maxShield = 0;
  out.shieldRegen = 0;
  out.speed = h.speed;
  out.accel = h.accel;
  out.dps = 0;
  out.range = 0;
  out.magnet = h.magnet;
  out.cargoCap = h.cargo;
  out.dmgMul = 1;
  out.size = h.size;
  out.splash = 0;
  out.laserTier = 0;
  for (const f of ship.slots) {
    if (!f) continue;
    const tier = f.tier - 1;
    for (const e of variantDef(f.type, f.variant).effects) {
      const value = e.values[tier]!;
      out[e.stat] =
        e.op === 'add' ? out[e.stat] + value : e.op === 'max' ? Math.max(out[e.stat], value) : out[e.stat] * value;
    }
  }
  const thrust = 1 + 0.08 * profile.perks.thrust;
  out.speed *= thrust;
  out.accel *= thrust;
  out.dps *= 1 + 0.12 * profile.perks.optics;
  return out;
}

export function shipStats(ship: Ship, profile: Profile): ShipStats {
  return writeShipStats(emptyStats(), ship, profile);
}

export const isFlagship = (ship: Ship): boolean => HULLS[ship.hullId].role === 'flagship';
export const isDrone = (ship: Ship): boolean => HULLS[ship.hullId].role === 'drone';
export const isHauler = (ship: Ship): boolean => HULLS[ship.hullId].role === 'hauler';
export const isAlive = (ship: Ship): boolean => ship.respawn <= 0;
export const cargoFree = (ship: Ship, st: ShipStats): number => Math.max(0, st.cargoCap - walletTotal(ship.cargo));

/** True when `ship` should stop mining and unload: the shared rule for drones, haulers, the bot and the HUD. */
export const isHoldFull = (ship: Ship, st: ShipStats): boolean =>
  cargoFree(ship, st) < Math.max(TUNING.fullHoldMin, st.cargoCap * TUNING.fullHoldShare);

export function makeShip(run: Run, profile: Profile, hullId: HullId, name: string, pos: Vec2): Ship {
  const h = HULLS[hullId];
  const slots = Array.from({ length: h.slots }, (_, i) => {
    const l = h.loadout[i];
    return l ? { ...l } : null;
  });
  const ship: Ship = {
    id: run.nextId++,
    name,
    hullId,
    pos: { ...pos },
    vel: v(),
    angle: -Math.PI / 2,
    hull: 0,
    shield: 0,
    slots,
    cargo: emptyWallet(),
    order: null,
    aiMode: 'assist',
    autoRepair: false,
    autoUpgrade: false,
    beamOn: false,
    beamTargetId: null,
    aiTargetId: null,
    thrusting: false,
    collisionCd: 0,
    respawn: 0,
  };
  const st = shipStats(ship, profile);
  ship.hull = st.maxHull;
  ship.shield = st.maxShield;
  return ship;
}

export function fleetCap(profile: Profile): number {
  return TUNING.baseFleetCap + profile.perks.bay;
}

export const droneCount = (run: Run): number => run.ships.filter((s) => !isFlagship(s)).length;

export const flagship = (run: Run): Ship => run.ships.find(isFlagship)!;

export const findShip = (run: Run, id: number): Ship | undefined => run.ships.find((s) => s.id === id);

/** The ship the player has selected, if it still exists. */
export const selectedShip = (run: Run): Ship | undefined => findShip(run, run.selectedId);

/** Applies damage through shields then hull. Handles death. */
export function damageShip(state: GameState, ship: Ship, raw: number): void {
  const { run, profile, out } = state;
  const st = shipStats(ship, profile);
  let dmg = raw * st.dmgMul;
  const absorbed = Math.min(ship.shield, dmg);
  ship.shield -= absorbed;
  dmg -= absorbed;
  ship.hull -= dmg;
  if (ship.hull > 0) return;

  out.fx.push({ t: 'explode', pos: { ...ship.pos } });
  profile.stats.shipsLost += 1;
  if (isFlagship(ship)) {
    out.log.push({ level: 'major', text: `${ship.name} destroyed! Cargo lost. Rebuilding at the station…` });
    ship.hull = 0;
    ship.cargo = emptyWallet();
    ship.respawn = TUNING.flagshipRespawn;
    ship.order = null;
    ship.beamOn = false;
    ship.vel = v();
  } else {
    out.log.push({ level: 'major', text: `${ship.name} was destroyed.` });
    removeItem(run.ships, ship);
    if (run.selectedId === ship.id) run.selectedId = flagship(run).id;
  }
}

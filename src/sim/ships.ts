// Ship construction, derived stats and damage.

import { v, type Vec2 } from '../core/vec';
import {
  ARMOR_DMG_MUL,
  ARMOR_HULL,
  CARGO_CAP,
  ENGINE_SPEED,
  LASER_DPS,
  LASER_RANGE,
  SENSOR_MAGNET,
  SHIELD_CAP,
  SHIELD_REGEN,
} from '../data/components';
import { HULLS, type HullId } from '../data/hulls';
import { emptyWallet, walletTotal } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { GameState, Profile, Run, Ship } from './types';

export interface ShipStats {
  maxHull: number;
  maxShield: number;
  shieldRegen: number;
  speed: number;
  accel: number;
  dps: number;
  range: number;
  magnet: number;
  cargoCap: number;
  dmgMul: number;
  size: number;
}

export function shipStats(ship: Ship, profile: Profile): ShipStats {
  const h = HULLS[ship.hullId];
  const s: ShipStats = {
    maxHull: h.hull,
    maxShield: 0,
    shieldRegen: 0,
    speed: h.speed,
    accel: h.accel,
    dps: 0,
    range: 0,
    magnet: h.magnet,
    cargoCap: h.cargo,
    dmgMul: 1,
    size: h.size,
  };
  for (const f of ship.slots) {
    if (!f) continue;
    const i = f.tier - 1;
    switch (f.type) {
      case 'laser':
        s.dps += LASER_DPS[i]!;
        s.range = Math.max(s.range, LASER_RANGE[i]!);
        break;
      case 'engine':
        s.speed += ENGINE_SPEED[i]!;
        s.accel += ENGINE_SPEED[i]! * 3;
        break;
      case 'shield':
        s.maxShield += SHIELD_CAP[i]!;
        s.shieldRegen += SHIELD_REGEN[i]!;
        break;
      case 'armor':
        s.maxHull += ARMOR_HULL[i]!;
        s.dmgMul *= ARMOR_DMG_MUL[i]!;
        break;
      case 'cargo':
        s.cargoCap += CARGO_CAP[i]!;
        break;
      case 'sensor':
        s.magnet += SENSOR_MAGNET[i]!;
        break;
    }
  }
  const thrust = 1 + 0.08 * profile.perks.thrust;
  s.speed *= thrust;
  s.accel *= thrust;
  s.dps *= 1 + 0.12 * profile.perks.optics;
  return s;
}

export const isFlagship = (ship: Ship): boolean => HULLS[ship.hullId].role === 'flagship';
export const isAlive = (ship: Ship): boolean => ship.respawn <= 0;
export const cargoFree = (ship: Ship, st: ShipStats): number => Math.max(0, st.cargoCap - walletTotal(ship.cargo));

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
    run.ships = run.ships.filter((s) => s !== ship);
    if (run.selectedId === ship.id) run.selectedId = flagship(run).id;
  }
}

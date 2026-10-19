// Offline progress (#41): a simplified estimate of what the fleet earned while
// the game was closed, applied once when a save loads. No tick is replayed:
// each drone mines at a flat rate from its laser dps, split by the mix of the
// belts it can reach, and outposts extract at their normal rate. Nothing here
// draws from an RNG or moves a ship, rock or pickup.

import { formatDuration } from '../core/format';
import { credit, RAW_RESOURCES, emptyWallet, formatWallet, walletTotal, walletValue } from '../data/resources';
import type { Wallet } from '../data/resources';
import { TUNING } from '../data/tuning';
import { yieldMul } from './mining';
import { isDrone, isHauler, shipStats } from './ships';
import type { GameState, LogEntry } from './types';

export interface OfflineGains {
  /** Seconds credited, after the cap. */
  seconds: number;
  /** Units added to the station bank. */
  bank: Wallet;
  /** The part of `bank` drones mined (the rest is outpost output a hauler ferried). */
  mined: number;
  /** Units added to outpost storage, waiting for a hauler. */
  stored: number;
  /** Reserve units each outpost extracts, by index into `run.automation.outposts`. */
  extract: number[];
  /** True when a hauler ferries outpost output to the bank, so none of it waits in storage. */
  ferried: boolean;
}

/** The share of drone income each raw resource gets: the belts within leash range of the station, by rock count. */
export function droneMix(state: GameState): Record<(typeof RAW_RESOURCES)[number], number> {
  const { system } = state.run;
  const stationR = Math.hypot(system.station.pos.x, system.station.pos.z);
  const mix = { ore: 0, ice: 0, crystal: 0 };
  let weight = 0;
  for (const b of system.belts) {
    const gap = stationR < b.inner ? b.inner - stationR : stationR > b.outer ? stationR - b.outer : 0;
    if (gap > TUNING.droneLeash) continue;
    const total = b.mix.ore + b.mix.ice + b.mix.crystal;
    if (total <= 0) continue;
    for (const r of RAW_RESOURCES) mix[r] += (b.mix[r] / total) * b.initialCount;
    weight += b.initialCount;
  }
  if (weight <= 0) return { ore: 1, ice: 0, crystal: 0 };
  for (const r of RAW_RESOURCES) mix[r] /= weight;
  return mix;
}

/**
 * What the fleet earns in `awaySec` real seconds away, capped at `TUNING.offlineCapSec`. Pure: reads `state` only.
 * Drones put their output straight into the bank. Outposts fill their own storage, or the bank when a hauler is
 * there to ferry it, and never past their reserve.
 */
export function offlineGains(state: GameState, awaySec: number): OfflineGains {
  const { run, profile } = state;
  const seconds = Math.min(Math.max(0, awaySec), TUNING.offlineCapSec);
  const bank = emptyWallet();
  const extract = run.automation.outposts.map(() => 0);
  let stored = 0;
  if (seconds <= 0) return { seconds, bank, mined: 0, stored, extract, ferried: false };
  const mul = yieldMul(state);

  let dps = 0;
  let haulers = 0;
  for (const s of run.ships) {
    if (isHauler(s)) haulers++;
    if (isDrone(s)) dps += shipStats(s, profile).dps;
  }
  const mined = dps * TUNING.offlineUnitsPerDps * TUNING.offlineEfficiency * mul * seconds;
  if (mined > 0) {
    const mix = droneMix(state);
    for (const r of RAW_RESOURCES) bank[r] += mined * mix[r];
  }

  run.automation.outposts.forEach((o, i) => {
    const room = haulers > 0 ? Infinity : Math.max(0, TUNING.outpostCapacity - walletTotal(o.stored)) / mul;
    const take = Math.max(0, Math.min(TUNING.outpostRate * seconds, o.reserve, room));
    extract[i] = take;
    if (haulers > 0) bank[o.kind] += take * mul;
    else stored += take * mul;
  });
  return { seconds, bank, mined, stored, extract, ferried: haulers > 0 };
}

/**
 * Credits offline progress for `awaySec` seconds and logs a summary, unless the time away is under
 * `TUNING.offlineMinSec` or less than a unit was earned. Returns the gains applied, or null.
 */
export function applyOffline(state: GameState, awaySec: number): OfflineGains | null {
  if (!(awaySec >= TUNING.offlineMinSec)) return null;
  const gains = offlineGains(state, awaySec);
  if (walletTotal(gains.bank) + gains.stored < 1) return null;
  const { run, profile } = state;
  const mul = yieldMul(state);
  credit(run.bank, gains.bank);
  run.runValue += walletValue(gains.bank);
  run.automation.outposts.forEach((o, i) => {
    const take = gains.extract[i]!;
    o.reserve -= take;
    if (!gains.ferried) o.stored[o.kind] += take * mul;
    run.automation.extracted += take * mul;
  });
  // Like play, only drone mining counts toward units mined; outpost extraction does not.
  profile.stats.unitsMined += gains.mined;
  state.out.log.push(offlineLog(gains, awaySec > TUNING.offlineCapSec));
  return gains;
}

/** The summary line, also shown as a toast. */
export function offlineLog(gains: OfflineGains, capped: boolean): LogEntry {
  const parts = formatWallet(gains.bank);
  const away = formatDuration(gains.seconds, { seconds: gains.seconds < 60 }) + (capped ? ' (cap)' : '');
  const lines: string[] = [];
  if (parts) lines.push(`fleet banked ${parts}`);
  if (gains.stored >= 0.5) lines.push(`outposts stored ${Math.floor(gains.stored)} units`);
  const detail = lines.join('; ') || 'fleet banked a few scraps';
  return {
    level: 'major',
    text: `While you were away (${away}): ${detail}.`,
    toast: { kicker: 'While you were away', title: away, detail: `${detail[0]!.toUpperCase()}${detail.slice(1)}.` },
  };
}

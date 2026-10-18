// Mining: laser damage, cracking into fragments and dropping pickups.
// Resource units are conserved: a cracked rock hands `crackChildShare` of
// its units to fragments and drops the rest; the smallest rocks drop all.

import { removeItem } from '../core/array';
import { range } from '../core/rng';
import { fromAngle, type Vec2 } from '../core/vec';
import { TUNING } from '../data/tuning';
import { contractProgress } from './contracts';
import { makeRock } from './generate';
import type { GameState, Rock, RockSize } from './types';

/** Fragments spawned per size class when a rock of that size cracks. */
const CHILDREN: Record<RockSize, number> = { 0: 3, 1: 2, 2: 0 };

export function yieldMul(state: GameState): number {
  return 1 + 0.1 * state.profile.perks.yield;
}

/** Splits `units` into roughly even pickup chunks around `pos`. */
export function dropPickups(state: GameState, rock: Rock, units: number): void {
  if (units <= 0) return;
  const { run } = state;
  const amount = units * yieldMul(state);
  const n = Math.max(1, Math.min(6, Math.ceil(units / 3)));
  for (let i = 0; i < n; i++) {
    const a = range(run.rng, 0, Math.PI * 2);
    const sp = range(run.rng, 15, 40);
    const off = fromAngle(a, range(run.rng, 0, rock.radius * 0.6));
    run.pickups.push({
      id: run.nextId++,
      kind: rock.kind,
      amount: amount / n,
      pos: { x: rock.pos.x + off.x, z: rock.pos.z + off.z },
      vel: { x: rock.vel.x + Math.cos(a) * sp, z: rock.vel.z + Math.sin(a) * sp },
      age: 0,
    });
  }
}

export function destroyRock(state: GameState, rock: Rock): Rock[] {
  const { run } = state;
  removeItem(run.rocks, rock);
  state.out.fx.push({ t: 'crack', pos: { ...rock.pos }, kind: rock.kind, radius: rock.radius });
  contractProgress(state, { t: 'break', size: rock.size });

  const kids = CHILDREN[rock.size];
  const spawned: Rock[] = [];
  let childUnits = 0;
  if (kids > 0) {
    const share = Math.floor((rock.units * TUNING.crackChildShare) / kids);
    if (share >= 1) {
      for (let i = 0; i < kids; i++) {
        const a = (i / kids) * Math.PI * 2 + range(run.rng, -0.4, 0.4);
        const p: Vec2 = {
          x: rock.pos.x + Math.cos(a) * rock.radius * 0.5,
          z: rock.pos.z + Math.sin(a) * rock.radius * 0.5,
        };
        const frag = makeRock(run, rock.kind, (rock.size + 1) as RockSize, p, share, rock.belt);
        frag.vel = { x: rock.vel.x + Math.cos(a) * 22, z: rock.vel.z + Math.sin(a) * 22 };
        run.rocks.push(frag);
        spawned.push(frag);
      }
      childUnits = share * kids;
    }
  }
  dropPickups(state, rock, rock.units - childUnits);
  return spawned;
}

/** Applies laser damage; returns fragments if the rock broke this tick. A dense rock takes nothing below its laser tier. */
export function laserRock(state: GameState, rock: Rock, dmg: number, laserTier: number): Rock[] | null {
  if (rock.trait === 'dense' && laserTier < TUNING.denseMinLaserTier) return null;
  rock.hp -= dmg;
  return rock.hp <= 0 ? destroyRock(state, rock) : null;
}

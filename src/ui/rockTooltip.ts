// Pure hover text for a rock: size, kind, optional trait, yield and remaining
// hp, plus its outpost (or how to deploy one). Lives outside `Hud` so it can be
// tested without a DOM.

import { RESOURCE_INFO, walletTotal } from '../data/resources';
import { TRAITS } from '../data/traits';
import { TUNING } from '../data/tuning';
import type { Outpost, Rock } from '../sim/types';

const SIZES = ['Large', 'Medium', 'Small'] as const;

/**
 * One-line rock tooltip, e.g. `Large ice asteroid · Volatile (explodes when cut) · 12 units · 100%`. A rock hosting
 * `outpost` shows its storage and reserve instead of hp; a large rock without one names `deployKey` when given.
 */
export function rockTooltip(rock: Rock, outpost?: Outpost, deployKey?: string): string {
  const def = rock.trait ? TRAITS[rock.trait] : null;
  const trait = def ? ` · ${def.name} (${def.blurb})` : '';
  const base = `${SIZES[rock.size]} ${RESOURCE_INFO[rock.kind].name.toLowerCase()} asteroid${trait} · ${rock.units} units`;
  if (outpost) {
    const stored = Math.floor(walletTotal(outpost.stored));
    return `${base} · Outpost: ${stored}/${TUNING.outpostCapacity} stored, ${Math.floor(outpost.reserve)} in reserve`;
  }
  const hp = Math.max(0, Math.ceil((rock.hp / rock.maxHp) * 100));
  const hint = deployKey && rock.size === 0 && !rock.comet ? ` · ${deployKey}: deploy outpost` : '';
  return `${base} · ${hp}%${hint}`;
}

// Pure hover text for a rock: size, kind, optional trait, yield and remaining
// hp. Lives outside `Hud` so it can be tested without a DOM.

import { RESOURCE_INFO } from '../data/resources';
import { TRAITS } from '../data/traits';
import type { Rock } from '../sim/types';

const SIZES = ['Large', 'Medium', 'Small'] as const;

/** One-line rock tooltip, e.g. `Large ice asteroid · Volatile (explodes when cut) · 12 units · 100%`. */
export function rockTooltip(rock: Rock): string {
  const def = rock.trait ? TRAITS[rock.trait] : null;
  const trait = def ? ` · ${def.name} (${def.blurb})` : '';
  const hp = Math.max(0, Math.ceil((rock.hp / rock.maxHp) * 100));
  return `${SIZES[rock.size]} ${RESOURCE_INFO[rock.kind].name.toLowerCase()} asteroid${trait} · ${rock.units} units · ${hp}%`;
}

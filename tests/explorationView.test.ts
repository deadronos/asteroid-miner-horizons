import { describe, expect, it } from 'vitest';
import { collectWorldLabels, type WorldLabel } from '../src/render/explorationView';
import { newGame } from '../src/sim/create';
import { anomalies, spawnRichRock } from '../src/sim/exploration';

describe('revealed anomaly labels', () => {
  it('labels nothing while anomalies are still hidden', () => {
    const { run } = newGame(4242);
    const out: WorldLabel[] = [];
    expect(collectWorldLabels(run, out)).toBe(0);
  });

  it('labels a revealed derelict with its glyph and hides it once claimed', () => {
    const { run } = newGame(4242);
    const derelict = anomalies(run).find((a) => a.kind === 'derelict')!;
    const out: WorldLabel[] = [];
    run.exploration.revealed.push(derelict.id);
    expect(collectWorldLabels(run, out)).toBe(1);
    expect(out[0]).toMatchObject({ kind: 'derelict', text: '⌖ Derelict', x: derelict.pos.x, z: derelict.pos.z });
    run.exploration.claimed.push(derelict.id);
    expect(collectWorldLabels(run, out)).toBe(0);
  });

  it('labels a rich rock after its deposit is revealed', () => {
    const { run } = newGame(4242);
    const rich = anomalies(run).find((a) => a.kind === 'rich');
    if (!rich || rich.kind !== 'rich') throw new Error('expected a rich anomaly');
    const out: WorldLabel[] = [];
    spawnRichRock(run, rich);
    expect(collectWorldLabels(run, out)).toBe(1);
    expect(out[0]).toMatchObject({ kind: 'rich', text: '◆ Rich deposit', x: rich.pos.x, z: rich.pos.z });
  });
});

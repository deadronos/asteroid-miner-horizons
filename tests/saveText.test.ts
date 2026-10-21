import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBot } from '../scripts/harness';
import { newGame } from '../src/sim/create';
import {
  exportCompact,
  exportText,
  parseImport,
  parseImportText,
  readSlot,
  serialize,
  writeSlot,
} from '../src/sim/save';
import type { GameState } from '../src/sim/types';
import { memStorage } from './memStorage';

/** A game the bot has played for a while, so the save has real fleets, rocks and timers. */
let played: GameState;
beforeAll(() => {
  played = newGame(12345);
  runBot(played, { seconds: 240, warp: true });
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage(), configurable: true });
});

const originalCompressionStream = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream');

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCompressionStream) Object.defineProperty(globalThis, 'CompressionStream', originalCompressionStream);
  else Reflect.deleteProperty(globalThis, 'CompressionStream');
});

async function compactText(text: string): Promise<string> {
  const gz = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `amh1:${btoa(bin)}`;
}

/** Every number in `a`, paired with the number at the same path in `b`. */
function pairs(a: unknown, b: unknown, out: [number, number][] = []): [number, number][] {
  if (typeof a === 'number') out.push([a, b as number]);
  else if (a && typeof a === 'object')
    for (const k of Object.keys(a)) pairs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], out);
  return out;
}

describe('save export text', () => {
  it('compact export is at most half the size of the exact save', async () => {
    writeSlot(0, played);
    const exact = localStorage.getItem('asteroid-miner-horizons/slot/0')!;
    const compact = await exportCompact(played, 0);
    expect(compact.length).toBeLessThan(exact.length * 0.5);
  });

  it('compact export round-trips: integers exact, floats to six significant digits', async () => {
    const res = await parseImportText(await exportCompact(played, 42));
    if (!res.ok) throw new Error(res.error);
    expect(res.record.savedAt).toBe(42);
    const got = JSON.parse(serialize(res.record.state));
    const nums = pairs(JSON.parse(serialize(played)), got);
    expect(nums.length).toBeGreaterThan(100);
    const off = nums.filter(([want, have]) =>
      Number.isInteger(want) ? have !== want : Math.abs(have - want) > Math.abs(want) * 1e-5,
    );
    expect(off).toEqual([]);
    expect(res.record.state.run.rng.s).toBe(played.run.rng.s);
  });

  it('imports plain JSON too: the rounded export and the exact record', async () => {
    const rounded = await parseImportText(exportText(played, 1));
    expect(rounded.ok).toBe(true);
    writeSlot(1, played);
    const exact = await parseImportText(localStorage.getItem('asteroid-miner-horizons/slot/1')!);
    expect(exact.ok && serialize(exact.record.state)).toBe(serialize(played));
  });

  it('rejects damaged compact text with a message instead of throwing', async () => {
    const text = await exportCompact(played, 0);
    expect(await parseImportText(text.slice(0, text.length / 2))).toEqual({
      ok: false,
      error: 'This save text is damaged or incomplete.',
    });
    expect((await parseImportText('amh1:not base64!')).ok).toBe(false);
  });

  it('falls back to plain JSON when compact export is unavailable', async () => {
    Object.defineProperty(globalThis, 'CompressionStream', { configurable: true, value: undefined });
    const text = await exportCompact(played, 42);
    expect(text.startsWith('amh1:')).toBe(false);
    expect(parseImport(text)).toEqual({ ok: true, record: { savedAt: 42, state: expect.anything() } });
  });

  it('rejects compact text that inflates beyond the safe import size', async () => {
    const huge = `${exportText(played, 7).slice(0, -1)},"padding":"${'x'.repeat(5 * 1024 * 1024)}"}`;
    expect(await parseImportText(await compactText(huge))).toEqual({
      ok: false,
      error: 'This save text is too large to import safely.',
    });
  });

  it('replaces out-of-range savedAt with the current time on import', () => {
    vi.spyOn(Date, 'now').mockReturnValue(777);
    const raw = JSON.stringify({
      format: 'amh-save',
      savedAt: 9_000_000_000_000_000,
      state: JSON.parse(serialize(played)),
    });
    expect(parseImport(raw)).toEqual({ ok: true, record: { savedAt: 777, state: expect.anything() } });
  });

  it('slots keep full precision', () => {
    writeSlot(2, played);
    expect(serialize(readSlot(2)!.state)).toBe(serialize(played));
  });
});

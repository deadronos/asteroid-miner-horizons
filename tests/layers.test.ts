// Layer boundaries (#126): encodes the "What may import what" table in
// docs/agents/repo-structure.md. `import/no-cycle` only catches cycles, not direction.
import { describe, expect, it } from 'vitest';

// The root tsconfig has `types: []`; referencing @types/node here would leak Node globals into src/.
interface Fs {
  readdirSync(path: URL, opts: { recursive: true; encoding: 'utf8' }): string[];
  readFileSync(path: URL, encoding: 'utf8'): string;
}
const { readdirSync, readFileSync } = (
  globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }
).process.getBuiltinModule('node:fs');

type Layer = 'core' | 'data' | 'sim' | 'render' | 'ui' | 'audio';

interface Rule {
  /** Layers this one may import from (its own layer is always allowed). */
  layers: Layer[];
  /** Top-level `src/*.ts` modules it may import, by file name. */
  top: string[];
  /** npm packages it may import; subpaths (`three/examples/...`) count as the package. */
  packages: string[];
}

const RULES: Record<Layer, Rule> = {
  core: { layers: [], top: [], packages: [] },
  data: { layers: [], top: [], packages: [] },
  sim: { layers: ['core', 'data'], top: [], packages: [] },
  render: { layers: ['core', 'data', 'sim'], top: ['settings.ts'], packages: ['three'] },
  ui: { layers: ['core', 'data', 'sim'], top: ['settings.ts', 'session.ts'], packages: [] },
  audio: { layers: ['core', 'sim'], top: ['settings.ts'], packages: [] },
};

// Read at run time, not via import.meta.glob: Vitest's module cache keeps a stale glob list when a file is added.
const SRC = new URL('../src/', import.meta.url);

/** Every module specifier in `from '...'`, bare `import '...'` and dynamic `import('...')`. */
function specifiers(source: string): string[] {
  // Static forms must start a line, so prose like `unbound from "${label}"` in a string is not an import.
  const re =
    /^\s*(?:(?:import|export)\s[^'"`;]*?\bfrom\s*|import\s*)(['"])([^'"\n]+)\1|\bimport\s*\(\s*(['"])([^'"\n]+)\3/gm;
  return Array.from(source.matchAll(re), (m) => m[2] ?? m[4]);
}

/** Normalises `a/./b/../c` to `a/c`; returns null if it climbs above the root. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

/**
 * The imports in `file` (a path relative to `src/`, e.g. `sim/update.ts`) that break its layer's rule.
 * Top-level files may import anything, so they never violate.
 */
function violations(file: string, imports: string[]): string[] {
  const layer = file.split('/')[0] as Layer;
  const rule = RULES[layer];
  if (!file.includes('/') || !rule) return [];
  return imports.filter((spec) => {
    if (!spec.startsWith('.')) {
      return !rule.packages.some((p) => spec === p || spec.startsWith(`${p}/`));
    }
    const dir = file.slice(0, file.lastIndexOf('/'));
    const target = normalise(`${dir}/${spec}`);
    if (target === null) return true;
    const head = target.split('/')[0];
    if (!target.includes('/')) return !rule.top.includes(`${head.replace(/\.ts$/, '')}.ts`);
    return head !== layer && !rule.layers.includes(head as Layer);
  });
}

describe('layer boundaries', () => {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.ts'));

  it('finds source files in every layer', () => {
    const empty = Object.keys(RULES).filter((layer) => !files.some((f) => f.startsWith(`${layer}/`)));
    expect(empty).toEqual([]);
  });

  it('every src/ module imports only what its layer allows', () => {
    const broken = files.flatMap((f) =>
      violations(f, specifiers(readFileSync(new URL(f, SRC), 'utf8'))).map((spec) => `${f} -> ${spec}`),
    );
    expect(broken).toEqual([]);
  });
});

describe('violations', () => {
  it('rejects the sim importing the renderer (the #126 repro)', () => {
    const src = "import { Renderer } from '../render/Renderer';\nexport const x = Renderer;";
    expect(violations('sim/__probe_layer.ts', specifiers(src))).toEqual(['../render/Renderer']);
  });

  it('rejects upward and sideways imports, including type-only and dynamic ones', () => {
    expect(violations('sim/x.ts', specifiers("import type { S } from '../settings';"))).toEqual(['../settings']);
    expect(violations('core/x.ts', specifiers("const m = import('../data/tuning');"))).toEqual(['../data/tuning']);
    expect(violations('render/x.ts', specifiers("export * from '../ui/dom';"))).toEqual(['../ui/dom']);
    expect(violations('audio/x.ts', specifiers("import { T } from '../data/tuning';"))).toEqual(['../data/tuning']);
    expect(violations('render/x.ts', specifiers("import { s } from '../session';"))).toEqual(['../session']);
  });

  it('rejects packages outside the layer allowance', () => {
    expect(violations('sim/x.ts', specifiers("import * as THREE from 'three';"))).toEqual(['three']);
    expect(violations('render/x.ts', specifiers("import { RenderPass } from 'three/examples/jsm/x.js';"))).toEqual([]);
  });

  it('allows same-layer, permitted-layer and listed top-level imports', () => {
    const src = [
      "import { a } from './a';",
      "import { b } from '../../sim/types';",
      "import { c } from '../../settings';",
      "import {\n  d,\n} from '../../session';",
    ].join('\n');
    expect(violations('ui/panels/x.ts', specifiers(src))).toEqual([]);
  });

  it('lets top-level files import anything', () => {
    expect(violations('main.ts', specifiers("import { R } from './render/Renderer';"))).toEqual([]);
  });
});

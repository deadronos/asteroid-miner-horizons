// Document contract for the static boot screen and metadata (#163).
import { describe, expect, it } from 'vitest';

// The root tsconfig has `types: []`; referencing @types/node here would leak Node globals into src/.
interface Fs {
  readFileSync(path: URL, encoding: 'utf8'): string;
}
const { readFileSync } = (
  globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }
).process.getBuiltinModule('node:fs');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('document metadata', () => {
  it('has a description, theme colour, favicon and social tags', () => {
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"/);
    expect(html).toContain('<meta name="theme-color" content="#03060d"');
    expect(html).toMatch(/<link\s+rel="icon"\s+href="data:image\/svg\+xml,/);
    for (const property of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:url'])
      expect(html).toContain(`property="${property}"`);
    expect(html).toContain('name="twitter:card"');
  });
});

describe('boot screen markup', () => {
  it('paints a title screen with Continue, New game and Settings', () => {
    expect(html).toContain('id="boot"');
    expect(html).toContain('id="boot-title"');
    expect(html).toContain('id="boot-summary"');
    expect(html).toContain('id="boot-new"');
    expect(html).toContain('id="boot-settings"');
    expect(html).toMatch(/id="boot-continue"[^>]*hidden/);
  });
});

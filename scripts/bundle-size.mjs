// Bundle-size budget (#216). Sums the gzipped JS in dist/assets and exits non-zero over the budget.
//
//   npm run build && npm run bundle-size
//   npm run bundle-size -- --budget 250   (kB)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DEFAULT_BUDGET_KB = 240;
const dir = 'dist/assets';

const flag = process.argv.indexOf('--budget');
const budgetKb = flag >= 0 ? Number(process.argv[flag + 1]) : DEFAULT_BUDGET_KB;
if (!(budgetKb > 0)) {
  console.error('--budget needs a positive number of kB');
  process.exit(2);
}

let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`${dir} not found; run \`npm run build\` first.`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`no .js files in ${dir}`);
  process.exit(2);
}

let total = 0;
for (const f of files.toSorted()) {
  const size = gzipSync(readFileSync(join(dir, f))).length;
  total += size;
  console.log(`${(size / 1000).toFixed(2).padStart(8)} kB gzip  ${f}`);
}
const totalKb = total / 1000;
const verdict = totalKb > budgetKb ? 'OVER' : 'ok';
console.log(`${totalKb.toFixed(2).padStart(8)} kB gzip  total (budget ${budgetKb} kB) ${verdict}`);
if (totalKb > budgetKb) {
  console.error(`Bundle is over budget by ${(totalKb - budgetKb).toFixed(2)} kB.`);
  process.exit(1);
}

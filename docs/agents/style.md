# Style

Code style and the lint rules that fail CI. `npm run check` enforces the formatter and linter parts.

- One short header comment per module stating what it is and any non-obvious rule. The existing headers are the
  model — declarative, present tense, no marketing.
- `/** */` on exported functions and on non-obvious fields. Skip comments that restate the code.
- `oxfmt` enforces printWidth 120, single quotes, trailing commas. Run `npm run format`.
- `oxlint` denies warnings: `import/no-cycle` is an error, `typescript/no-explicit-any` is an error, and unused
  args/vars must be `_`-prefixed. `eqeqeq` is "smart".

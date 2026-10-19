# Cheaper autosave and smaller exports

- **Date:** 2026-10-19
- **Issue:** #17 — "Cheaper autosave and smaller exports"
- **Parent:** #18 — "Performance: allocation-free ticks, culling, benchmarks"
- **Status:** Design of record

## Context

Every slot write went through `exportText`, which stringified the state, parsed it back and stringified it again
inside a record, synchronously on a `setInterval`. The same full-precision text was what the player copied out
of the Export window. A bot-played save is 55–100 KB.

## Decisions

1. **Slots stay exact; only export rounds.** `writeSlot` builds the record by string concatenation around
   `serialize(state)` (one stringify, no re-parse), so a local save still replays bit-for-bit. `exportText` now
   rounds every non-integer number to 6 significant digits. Integers (ids, counters, colours, `rng.s`) are
   untouched, so RNG streams and id counters survive an export exactly; positions and timers move by at most
   one part in 10⁵.
2. **Copy-paste text is gzipped.** `exportCompact` gzips the rounded JSON with the platform `CompressionStream`
   and base64s it behind an `amh1:` prefix: about 24% of the exact save (rounding alone only reaches ~70%).
   No dependency is added; `CompressionStream` is in every current browser and in Node 22.
3. **Import accepts all three shapes.** `parseImportText` decompresses `amh1:` text and otherwise falls through
   to `parseImport`, so older JSON exports, downloaded `.json` files and bare states still load. Damaged
   compact text is rejected with a message, never an exception. Import and export are async in the UI only.
4. **Download stays JSON.** "Download .json" writes the rounded, readable `exportText`, so a file can still be
   eyeballed.
5. **Autosave runs at idle.** The interval queues one save with `requestIdleCallback` (2 s timeout, `setTimeout`
   fallback where it is missing). Only one is ever queued, an immediate save cancels it, and `stop()` drops it.
   The hide/unload saves stay synchronous because the page may be gone before an idle callback.

## Measurement

`npm run bench` now writes the benchmark save to a slot 100 times and reports its size, the compact export size
and the write time, warning if a write exceeds 16 ms. In headless Chromium on the same save (58 KB, 6 ships,
213 rocks) a slot write took 0.3 ms median / 0.6 ms max (previously 0.6 / 5.7 ms), and a compact export about
5 ms, which only happens on a click.

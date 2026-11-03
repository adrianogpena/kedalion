// WCAG contrast of text-vs-surface token pairs for every palette (dark and light), text output only.
// Each pair has its own floor (CONTRAST_FLOORS in palettes.ts). Translucent colours are composited over --bg.
// Exits 1 when any pair fails; no images (design/reimagine-plan.md, step 6).
import { CONTRAST_FLOORS, PALETTES, composite, contrastRatio, type Palette } from '../packages/server-core/src/palettes';

export function paletteFailures(p: Palette): string[] {
  const base = composite(p.tokens['--bg'], [0, 0, 0]);
  const failures: string[] = [];
  for (const [fg, bgs, floor] of CONTRAST_FLOORS) {
    for (const bg of bgs) {
      const surface = composite(p.tokens[bg], base);
      const ratio = contrastRatio(composite(p.tokens[fg], surface), surface);
      if (ratio < floor) failures.push(`${fg} on ${bg} ${ratio.toFixed(2)}:1 < ${floor}:1 (${p.tokens[fg]} on ${p.tokens[bg]})`);
    }
  }
  return failures;
}

if (import.meta.main) {
  let failed = 0;
  for (const p of PALETTES) {
    const failures = paletteFailures(p);
    failed += failures.length;
    for (const f of failures) console.error(`${p.id} (${p.kind}): ${f}`);
  }
  if (failed) {
    console.error(`${failed} contrast pair(s) below their floor in ${PALETTES.length} palettes`);
    process.exit(1);
  }
  console.log(`contrast ok (${PALETTES.length} palettes)`);
}

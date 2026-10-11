/** Deterministic large diff: 300 files × ~17 hunks ≈ 5.1k hunks. */
export function makeLargePatch(files: number, hunksPerFile: number): string[] {
  const out: string[] = [];
  for (let f = 0; f < files; f++) {
    const name = `src/gen/mod${f}.py`;
    let patch = `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n`;
    for (let h = 0; h < hunksPerFile; h++) {
      const start = 1 + h * 40;
      patch += `@@ -${start},12 +${start},14 @@ def fn_${h}():\n`;
      for (let i = 0; i < 4; i++) patch += ` ctx line ${h}-${i} value = ${i}\n`;
      patch += `-old line ${h} alpha = compute(x)\n`;
      patch += `-old line ${h} beta = compute(y)\n`;
      patch += `+new line ${h} alpha = compute_v2(x, flag=True)\n`;
      patch += `+new line ${h} beta = await compute_v2(y)\n`;
      patch += `+new line ${h} gamma = normalize(alpha, beta)\n`;
      for (let i = 0; i < 3; i++) patch += ` tail ${h}-${i} return gamma\n`;
    }
    out.push(patch);
  }
  return out;
}

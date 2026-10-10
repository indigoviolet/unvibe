/**
 * Deterministic synthetic ~30k-token "pack" for the M0 ACP spike.
 *
 * A fake unified diff with numbered lines (L0001..) and a handful of unique
 * facts planted at known lines. Each fact appears exactly once so fork
 * answers can be checked for correctness.
 */

export interface PlantedFact {
  id: string;
  /** line number (1-based) where the fact lives */
  line: number;
  question: string;
  /** substring that must appear in a correct answer */
  answerMustContain: string;
  /** the fact sentence as planted */
  sentence: string;
}

/** mulberry32 — deterministic PRNG so runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILLER_FUNCS = [
  "normalize_path",
  "resolve_endpoint",
  "parse_retry_header",
  "merge_config_layer",
  "validate_checksum",
  "render_status_line",
  "compact_history",
  "encode_cursor",
  "decode_cursor",
  "shard_lookup",
  "refresh_lease",
  "drain_queue",
  "coalesce_writes",
  "split_shard_key",
  "verify_signature",
  "rotate_secret",
];

const FILLER_WORDS = [
  "idempotent",
  "throughput",
  "backpressure",
  "checkpoint",
  "idempotency",
  "watermark",
  "compaction",
  "fanout",
  "jitter",
  "saturation",
  "hedged",
  "quorum",
  "lease",
  "epoch",
  "shard",
  "cursor",
];

/**
 * Facts planted in the pack. Unique tokens (fact ids like ZK-4177) appear
 * exactly once in the whole pack.
 */
export const PLANTED_FACT_SENTENCES: Array<{
  id: string;
  sentence: string;
  question: string;
  answerMustContain: string;
}> = [
  {
    id: "ZK-4177",
    sentence:
      "The global retry budget constant RETRY_BUDGET_MS is set to 4500 milliseconds (fact ZK-4177).",
    question: "What is the value of RETRY_BUDGET_MS in milliseconds?",
    answerMustContain: "4500",
  },
  {
    id: "ZK-9182",
    sentence:
      "If the primary region fails, traffic falls back to the eu-west-2 region (fact ZK-9182).",
    question: "Which region is the fallback region if the primary fails?",
    answerMustContain: "eu-west-2",
  },
  {
    id: "ZK-3355",
    sentence:
      "Entries in the negative-lookup cache expire after a TTL of 900 seconds (fact ZK-3355).",
    question: "What is the TTL in seconds for the negative-lookup cache?",
    answerMustContain: "900",
  },
  {
    id: "ZK-6041",
    sentence:
      "The team that owns the shard rebalancer is the Storage Platform team (fact ZK-6041).",
    question: "Which team owns the shard rebalancer?",
    answerMustContain: "Storage Platform",
  },
  {
    id: "ZK-7723",
    sentence:
      "The maximum batch size for the drain_queue worker is 256 items per batch (fact ZK-7723).",
    question: "What is the maximum batch size of the drain_queue worker?",
    answerMustContain: "256",
  },
  {
    id: "ZK-2089",
    sentence:
      "The wire protocol version pinned by the handshaker is version 11 (fact ZK-2089).",
    question: "What wire protocol version does the handshaker pin?",
    answerMustContain: "11",
  },
];

export interface Pack {
  text: string;
  lines: number;
  approxTokens: number;
  facts: PlantedFact[];
  /** byte length, for byte-identical fallback checks */
  bytes: number;
}

/** Build the pack. Deterministic for a given seed. */
export function buildPack(seed = 1234, targetChars = 120_000): Pack {
  const rand = mulberry32(seed);
  const bodyLines: string[] = [];
  const facts: PlantedFact[] = [];

  bodyLines.push(
    "From: synthetic-pack-generator <spike@unvibe.local>",
    "Subject: [fake-review] shard router refresh (SYNTHETIC, for cache testing)",
    "",
    "This is a synthetic change description used to test agent context caching.",
    "It is NOT real code. Answer questions about it using ONLY the text below.",
    "",
  );

  // Leave room: header ~10 lines, then files.
  let fileIdx = 0;
  while (bodyLines.join("\n").length < targetChars) {
    fileIdx += 1;
    const path =
      fileIdx % 3 === 0
        ? `src/router/shard_${fileIdx}.py`
        : fileIdx % 3 === 1
          ? `src/config/layer_${fileIdx}.py`
          : `tests/test_layer_${fileIdx}.py`;
    bodyLines.push(`diff --git a/${path} b/${path}`);
    bodyLines.push(`--- a/${path}`);
    bodyLines.push(`+++ b/${path}`);
    const hunkStart = 10 * fileIdx;
    const hunkLen = 45 + Math.floor(rand() * 20);
    bodyLines.push(`@@ -${hunkStart},${hunkLen} +${hunkStart},${hunkLen + 2} @@`);
    for (let i = 0; i < hunkLen; i++) {
      const fn = FILLER_FUNCS[Math.floor(rand() * FILLER_FUNCS.length)];
      const w1 = FILLER_WORDS[Math.floor(rand() * FILLER_WORDS.length)];
      const w2 = FILLER_WORDS[Math.floor(rand() * FILLER_WORDS.length)];
      const n = Math.floor(rand() * 100000);
      bodyLines.push(
        `     result = ${fn}(ctx, ${w1}=${n}, ${w2}="${w1}-${w2}-${fileIdx}-${i}")  # see ${path}`,
      );
    }
    // Changed lines to look diff-like.
    bodyLines.push(`-    return old_${fileIdx}(ctx)`);
    bodyLines.push(`+    return new_${fileIdx}(ctx, migrated=True)`);
  }
  // Plant each fact at an even fraction of the body so they are spread out.
  const total = bodyLines.length;
  PLANTED_FACT_SENTENCES.forEach((f, k) => {
    const at = Math.floor(((k + 1) * total) / (PLANTED_FACT_SENTENCES.length + 1));
    bodyLines.splice(at, 0, `+    # NOTE: ${f.sentence}`);
    facts.push({ ...f, line: -1 });
  });

  // Number every line L0001.. so questions/answers can cite positions.
  const numbered = bodyLines.map(
    (l, i) => `L${String(i + 1).padStart(4, "0")}: ${l}`,
  );
  const text = numbered.join("\n") + "\n";
  // Resolve fact line numbers.
  for (const f of facts) {
    const idx = numbered.findIndex((l) => l.includes(f.id));
    f.line = idx + 1;
  }
  return {
    text,
    lines: numbered.length,
    approxTokens: Math.round(text.length / 4),
    facts,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

/** Prompt message that carries the pack as the base turn. */
export function basePackMessage(pack: Pack): string {
  return (
    "You are helping review a code change. Below is the FULL change pack " +
    "(a synthetic diff with numbered lines L0001..). Read it carefully and remember it; " +
    "you will be asked questions about it in follow-up turns. " +
    "Do NOT call any tools for this message. Reply with exactly the word READY " +
    "and nothing else.\n\n" +
    "===== BEGIN CHANGE PACK =====\n" +
    pack.text +
    "===== END CHANGE PACK ====="
  );
}

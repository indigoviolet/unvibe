`_normalize_header_values` is the workhorse of this change: it takes a whole header block, unfolds every folded value in it, and puts the block back together so that nothing downstream ever sees a raw line break inside a value. It is called on both header containers urllib3 exposes — the `HTTPHeaderDict` built from a response and the `HTTPMessage` that `http.client` produces — so code reading either one sees the same clean values.

The helper works in two passes over `message.items()`. The first pass is read-only: it walks the list of `(name, value)` pairs and checks each value for a fold. Most header blocks contain no folds at all, and for those the helper returns without touching the message. That matters because rebuilding a header block is not free, and because it is not invisible either: rebuilding can disturb internal bookkeeping in the underlying `email.message` machinery, so a block that needs no change should keep its original object exactly as it was.

Only when at least one value actually contains a fold does the helper move to its second pass. It deletes every header from the message, then re-adds the pairs one at a time, in the original order, running each value through `_normalize_header_value` on the way back in. Deleting and re-adding is the reliable way to replace values in an `HTTPMessage`: assigning through the mapping interface can append a second header with the same name instead of replacing the first, which would duplicate the header rather than clean it.

`_normalize_header_value` itself starts with a fast path: if the value contains no `"\r\n"`, return it unchanged. The full pattern requires a CRLF followed by optional whitespace, so a value without CRLF cannot contain a fold this change is responsible for. The fast path keeps the common case — the overwhelming majority of headers, whose values are short and unfolded — down to a single substring check, with no regular-expression engine involved at all.

When the fast path does find a CRLF, the compiled pattern `_OBSOLETE_FOLD_RE` takes over. It matches a CRLF, then consumes any mix of spaces and tabs that follows it, and the substitution replaces the whole match with exactly one space. One space, always: whether the original fold was indented with one space, eight spaces, or a tab, the unfolded value reads the same. RFC 9112 permits one or more spaces at the join, and one space is the choice that keeps re-emitted headers tidy without inventing spacing that was never in the logical value.

A bare LF — a line break with no carriage return before it — is deliberately not treated as a fold here. `http.client` accepts header lines that end in a bare LF, so a value like `a=1\n b=2` can exist, but both the fast path and the pattern only look for CRLF. That asymmetry is a known edge of this change, not an oversight in the pattern: tightening it would change values that today pass through untouched, and it deserves its own decision rather than a silent ride-along in this one.

Duplicates survive the rebuild. Because the first pass reads `message.items()`, repeated headers — two `Set-Cookie` lines, say — come back as separate pairs, and the second pass re-adds them as separate headers in the same positions, with other headers still interleaved between them where they were. Nothing is coalesced into a single comma-joined header, which keeps `Set-Cookie` semantics intact: cookie headers must never be merged, because their values can themselves contain commas in dates.

Order is likewise preserved for every header, not just duplicates. The re-added list is the list that was read, element for element; only the values differ, and only where a fold was replaced. A caller comparing the block before and after sees the same names in the same order with the same multiplicity — the smallest behavioural footprint a normalizing pass can have.

There is a cost worth naming. For a block that does contain a fold, the rebuild is linear in the number of headers, and each re-added header goes through the message object's own insertion path, with its own small overheads. Header blocks are small — tens of entries, not thousands — so this is not a hot-path concern in practice. The expensive failure mode would have been running the regular expression over every value of every header block, including the vast majority with no folds; the fast path and the read-only first pass exist precisely to avoid that.

Identity is the subtler property. When nothing needs to change, the message object is untouched: any other reference to it sees the same state, and nothing about the object is invalidated. When something does change, the object is mutated in place rather than replaced, so existing references — the response object holding the message, for instance — see the cleaned values without anyone having to re-fetch the container. Both choices follow from the same principle: the helper should be safe to call speculatively, on every header block, without the caller needing to know in advance whether folds are present.

The tests around the helper mirror that split. One test feeds a value with a very long run of spaces after the fold, checking that the substitution stays linear and cannot fall into the quadratic backtracking a looser pattern would allow. Others cover the CRLF fold directly, headers separated by unrelated headers, and the case where no header in the block is folded at all. What they do not yet cover is the bare-LF value described above — a gap the finding on this PR already calls out.

In short: read first, change nothing when nothing is folded, rebuild faithfully when something is — same names, same order, same duplicates, values joined with a single space — and keep the whole thing cheap enough to run on every response by default.

::: simple
It cleans folded headers in a whole header block. First it checks whether anything is folded at all; if not, it changes nothing. If something is, it rebuilds the block in the same order, replacing each fold with one space. Duplicates like two `Set-Cookie` headers stay separate.
:::

::: deep
The two-pass shape is the point. A single-pass version that rewrote values as it scanned would mutate the container while iterating over it, and would pay the rebuild cost for every block. Splitting detection from rebuilding keeps the no-fold case free and the fold case faithful: the rebuilt block is element-for-element the old block, with only folded values altered. The one asymmetry is the bare LF, which `http.client` can produce but neither the fast path nor the pattern treats as a fold.
:::

::: example
```
Set-Cookie: a=1; path=/ <CR><LF>
    Max-Age=900<CR><LF>
Set-Cookie: b=2; path=/

# before: first value holds a raw CRLF and its indentation
# after:  'a=1; path=/ Max-Age=900', and both Set-Cookie
#         headers are still separate, in the same order
```
:::

```json
{
  "title": "Normalizing a whole header block"
}
```

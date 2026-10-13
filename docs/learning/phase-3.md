# Phase 3 — Learning notes

**Log templates.** A busy service writes millions of lines, but they come from a few hundred
`logger.info("...")` calls in the code. `GET /orders/42 200` and `GET /orders/7 200` are the same
sentence with different blanks filled in. A _template_ is the sentence with the blanks marked:
`GET /orders/<*> <*>`. Grouping lines by template turns "2 million lines" into "40 kinds of
things that happened, and how often". Analogy: a form letter. Thousands of letters went out, but
there is one form and a list of who filled in which blanks.

**Masking.** Before comparing lines we replace the parts that obviously vary (numbers, UUIDs, IP
addresses, long hex strings) with `<*>`. That makes `ch_483921` and `ch_100002` look identical
(`ch_<*>`) without any cleverness. It is the cheap first pass; the parser below handles the
variable parts masking cannot recognise (names, hostnames, free text).

**Drain (online log parsing).** Drain reads lines one at a time and keeps a small tree of the
templates it has seen so far. To place a new line it (1) goes down the tree by the line's length
in words and its first word, which narrows it to a handful of candidate templates, then (2) counts
how many word positions match each candidate. If at least 70% match, the line joins that
template, and any position that differs becomes `<*>` (the template "learns" that this slot
varies). If nothing is close enough, the line starts a new template. Analogy: a post office
sorting letters. First by country (length), then by city (first word), and only then does a
clerk compare the actual address line against the few pigeonholes in that bin. It is fast because
it never compares a line with every template, and it needs no training data. Our version is
`apps/api/src/templates/drain.ts`; it knows nothing about the database so it can be tested with
plain inputs and property tests.

**Why the similarity threshold matters.** At 50%, `charge ch_<*> succeeded` and `charge ch_<*>
retried` (2 of 3 words equal) merged into one template and lost the difference between a success
and a retry. At 70% they stay apart. Every Drain setup is a trade-off between merging too much
(you lose meaning) and splitting too much (you get thousands of near-duplicate templates).

**Per-minute counts.** For each template we store "how many times in this minute" in
`template_minute_counts`. This is a tiny time series per template and is all the spike detector
needs; it never re-reads raw log rows.

**New-template detection.** Something you have never seen before is often the interesting thing:
a new error after a deploy. The only subtlety is the beginning: on day one _everything_ is new. So
each service has a _warm-up_ period after its first line during which new templates are ignored.

**Baselines and EWMA.** To say "this minute is unusually busy" you need a notion of usual. The
simplest is an average, but an average of the whole history reacts too slowly when traffic changes
over the day. An _exponentially weighted moving average_ (EWMA) is an average where recent minutes
count more: each new minute moves the baseline a fixed fraction (`alpha`, here 0.2) of the way
toward it. Analogy: a thermostat that remembers yesterday a little and the last hour a lot.

**Z-score.** "How unusual?" is measured in units of how much the value normally wobbles. A
_z-score_ is `(value − baseline) / typical wobble`. If the baseline is 20 events/minute and it
normally wobbles by about 4.5, then 90 events is `(90 − 20) / 4.5 ≈ 15` wobbles above normal, which
is far outside normal. 25 events is about 1: nothing to see. We flag z ≥ 4 by default. For the
wobble we use the larger of the measured spread and `sqrt(baseline)`, because counts of
independent events naturally vary by roughly the square root of their average (the Poisson
rule of thumb); this stops a perfectly flat history from making tiny changes look huge.

**Guard rails.** A z-score alone is noisy for small numbers: going from 1 event to 8 is "8×
usual" but means nothing. So a spike also needs a minimum count (default 10 in the minute) and
enough history (default 10 minutes). Minutes that look like spikes only nudge the baseline a
little, otherwise a long incident would teach the baseline that "this is normal" and stop being
reported. Consecutive spike minutes are merged into one anomaly so you see one incident, not
twelve alerts.

**Why a separate worker.** Ingestion must stay fast and simple. Detection looks at the last full
minute once a minute and does not need to be in the request path, so it runs as its own process
(`npm run worker -w apps/api`). It takes "now" as an input, so the same code can be replayed over
old data (`npm run detect:replay`) or tested minute by minute.

**What the evaluation does (and does not) show.** `anomalies/loggen.eval.test.ts` ingests a
synthetic run in which three incidents were injected on purpose, replays the clock, and checks the
detector found each one and nothing else. It shows the pipeline works end to end. It does not show
the detector is good on real traffic: the injected incidents are large and the background is
well-behaved, which is the easy case.

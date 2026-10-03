# The 90 seconds

## Before you go on

- [ ] `npm run verify` passed this morning, on venue wifi
- [ ] Demo source **already processed once** — transcription is the long pole
      and clip URLs encode on first request. Run it, then re-run it on stage.
- [ ] A screen recording of a clean run in a background tab
- [ ] Pick a source with real moments in it: a podcast clip with a number, a
      question, and an argument. A monotone lecture produces honest but boring
      clips.
- [ ] Browser console closed, zoom at 125%

## The script

**0:00 — Open on the problem.**

"A two-hour podcast has about eight minutes anyone would share. Finding them
means scrubbing the whole thing. Then you cut each one four more times, because
Reels and the feed and YouTube all want a different shape."

**0:12 — Drop the video in. Let it run.**

Narrate the stages as they light up: listening, choosing moments, cutting.

**0:35 — The number lands.**

"Twenty-four ready-to-post videos from six moments it found in two hours of
footage."

**0:45 — Scroll to a clip. Point at the filmstrip.**

"Six frames from across the clip. That's not decoration — it's how you can tell
at a glance that the subject tracking held. The speaker stays in frame through
the whole vertical crop."

**1:00 — Point at the reason chip. This is the beat.**

"It didn't pick this at random. It opens on a question, it has a specific
figure in it, and it lands its ending rather than trailing off. Every clip tells
you why it was chosen."

**1:15 — Switch formats on one clip.**

Click through vertical, square, wide. Same moment, four shapes, captions burned
in on the ones that autoplay muted.

**1:25 — Land it.**

"One upload, one pipeline, every platform."

Stop talking.

## Questions you will get

**"How does it decide what's a good clip?"**
Structure, not sentiment. Hooks in the opening line, pace scored as a curve,
filler penalised, and endings judged separately from openings. Open
`packages/cutplan/src/plan.ts` if asked — it reads cleanly and it is obviously
domain work rather than glue.

**"Why score the ending separately?"**
Because a test caught it. Averaging filler across a window let a clip open
strong, trail off into "um, yeah, anyway", and still score well — the dead air
was diluted by the good part. Viewers don't average. That fix is in the repo
with the test that forced it.

**"Why not just use an LLM to pick clips?"**
You should, as a second scorer — and `plan()` is shaped for exactly that. But a
model alone gives you no explanation you can check and no way to test
regression. This runs in nine milliseconds with no network and twenty tests.

**"What's yours versus Cloudinary's?"**
`packages/cutplan`. Pure TypeScript, zero dependencies.

## If something breaks

Switch to the recording without apologising. Keep talking about the planner,
which needs no network at all.

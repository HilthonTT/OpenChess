<!--
Thanks for the pull request. Fill in what's relevant and delete what isn't —
a one-line typo fix does not need the whole form.
-->

## What this changes

<!-- The change itself, in a sentence or two. -->

## Why

<!--
The reason it is worth making. If it fixes an open issue, link it here so
GitHub closes it on merge: "Closes #123".
-->

## How I checked it

<!--
Not "it works" — what you actually did. For anything visible in the terminal,
paste the frame or a screenshot: a description of a layout is never quite the
layout.
-->

- [ ] `bun run typecheck` passes
- [ ] `bun test` passes
- [ ] Ran it against a local server, if it touches anything online

## Notes for the reviewer

<!--
Anything that would be hard to see from the diff: a decision you went back and
forth on, a case you deliberately left out, something you'd like a second
opinion on.
-->

---

- [ ] If this adds or changes a key, `useKeymap` describes it and `?` shows it
- [ ] If this adds a screen, it is registered in `lib/screens.ts`
- [ ] If this changes the schema, a migration is included and the seed still
      re-runs cleanly

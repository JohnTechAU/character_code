# Adventure Land Character Code

Version-controlled character scripts for Adventure Land, organized to keep
shared logic in one place and character files thin.

## Why this structure

The game's CODE tab only ever runs one flat script per character — there's
no `import`/`require()` inside it. So the repo is organized around a simple
split:

- **Shared logic** — generic, reusable functions (the *how*)
- **Character files** — per-class config and orchestration that calls the
  shared functions with class-specific values (the *what*)

This keeps a bugfix to one function as a one-file change, instead of a
hunt-and-patch across every character.

## Folder structure

```
adventureland-code/
  shared/
    thresholds.js     # checkAndUseThreshold and similar generic checks
    targeting.js       # targeting priority chain
    healing.js          # party-aware healing logic (in progress)
  characters/
    warrior.js
    priest.js
    merchant.js
  build/               # generated, combined output — not hand-edited (future)
  README.md
```

## Current workflow: manual combine

Right now, getting code into the game is:

1. Edit the relevant file in `shared/` or `characters/`.
2. Copy the contents of the needed `shared/` file(s) to the top of the
   character file.
3. Paste the combined result into that character's slot in the in-game
   CODE tab (`-` key).

**Known limitation:** shared functions are duplicated across character
files, so if `checkAndUseThreshold` changes, every character file that
uses it needs re-pasting. Keep an eye out for drift — if a character
starts behaving inconsistently, check whether its copy of a shared
function is stale first.

## Planned improvement: build script

Next step is a small script (Node or shell) that concatenates
`shared/*.js` + `characters/X.js` → `build/X.js` automatically, so the
copy-paste step pastes generated output instead of a hand-merged file.
This removes the drift risk without needing a full bundler yet.

Longer-term options if this repo grows a lot:
- **Bundler (webpack)** — real `import` syntax, can push straight to the
  game's save slots via its API.
- **Remote loader** — an in-game script fetches `shared/` files live from
  this repo's raw GitHub URL at runtime. Only use with a repo you control;
  a malicious remote script can hijack your account.

## Shared functions (current)

- `checkAndUseThreshold(currentValue, maxValue, thresholdBelowMax, skillName)`
  — generic "if below X%, use skill" check. Same function, different
  numbers per character.
- Targeting priority chain — same idea, generic logic, character-specific
  parameters.

Both are simple enough to leave inline/duplicated for now rather than
building a load mechanism just for them — revisit if that stops being true.

## Planned: party healing

Healing needs to look outward at party members' hp, not just the
character's own state — different job from `checkAndUseThreshold`, so it
gets its own function (`healParty` or similar) in `shared/healing.js`
rather than being folded into the threshold checker. Still being fleshed
out.

## Conventions

- **Character files stay thin**: mostly `setInterval` loop + calls into
  `shared/` with this character's own numbers. If a character file starts
  accumulating real logic, that's a signal that logic belongs in `shared/`
  and this file's shape isn't being kept to.
- **Commit working states, not every experiment.** Adventure Land itself
  won't tell you what broke — your commit history is the debugging trail.
- **Comment header per file** noting class/role, e.g.:
  ```js
  // characters/priest.js — heals party, kites via ranged attacks
  ```
- **Note bugs fixed in commit messages** (e.g. "fixed threshold using <=
  instead of ="). Doubles as a changelog of real gotchas hit.
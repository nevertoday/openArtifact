# The interface ruler

How the interface of Open Artifact is measured. A score means something only when it names the commit it measured and
the method that produced it, so the method lives here, next to the code.

Everything runs against the disposable stack of the `verify-open-artifact` skill, never the developer's `pnpm dev`.

```sh
node scripts/ux-ruler/seed.mjs 100     # a fresh stack with 0, 8 or 100 sample pages, two people, comments, a removed page
node scripts/ux-ruler/gates.mjs        # the twelve hard gates; exits 1 when any fails
node scripts/ux-ruler/gates.mjs 2 11   # only some of them
node scripts/ux-ruler/shoot.mjs        # screenshots of every page on the list, for the seeded size
node .claude/skills/verify-open-artifact/scripts/oa-verify.mjs stop
```

Results go to `.verify/ux-ruler/` (gitignored): `gates.json` records the commit and each gate's offenders, `shots/`
holds the screenshots by commit and seed size.

## Two layers

**Hard gates** are measured by `gates.mjs`. Each is a property a script can decide; none can be traded against a high
score elsewhere. While any gate fails, the overall score is capped at 8.5.

| # | Gate |
| --- | --- |
| 1 | No page, and no table in it, is wider than a 390px window |
| 2 | Every control on a touch screen answers within a 44×44 box around its centre |
| 3 | Text contrast is at least 4.5:1, large text and icons at least 3:1, in light and dark |
| 4 | Card bylines are whole at 1280, 1440 and 1920 |
| 5 | With 100 pages every card has a cover, the whole list can be reached, and the page loads as fast as a short list |
| 6 | A screen reader hears the visibility and comment count on each card |
| 7 | The Chinese interface has one word for one thing: an artifact is a 页面 |
| 8 | The sign-in code step and a half-written reply survive a refresh |
| 9 | On a phone, back closes the open panel before it leaves the page |
| 10 | The Tab order has no stop that does nothing |
| 11 | On a phone the top bar is one row, and at most 56px stays stuck to the top |
| 12 | Every popover, dialog and composer opens inside the window |

**Anchored scores** come from reviewers who see only the screenshots of `shoot.mjs`, never the code or an earlier
score. Each reviewer scores the same set three times; the median counts, and the spread between runs is the noise. A
change in score smaller than the noise is not a change.

| Score | What it takes |
| --- | --- |
| 7 | Everything works and no state is broken, but the layout reads as engineer-made |
| 8 | Visually consistent; nothing obviously wrong in any screenshot |
| 9 | Every hard gate passes. A new person connects an agent, publishes, comments and shares without reading documentation. Empty, error, loading and recovery states are all designed |
| 9.5 | It still holds with 100 pages, long titles, Chinese and English mixed, and one-handed use on a phone. The median of three scorings reaches 9.5 |

Reviewers score seven dimensions from 0 to 10 and the overall score is their mean: visual craft, hierarchy and
layout, interaction clarity, consistency, phone experience, states (empty, error, loading, recovery), and copy.

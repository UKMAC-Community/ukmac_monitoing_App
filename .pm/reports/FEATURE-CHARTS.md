# FEATURE-CHARTS · Four additional dashboard charts

State: READY_FOR_REVIEW. Worker: chart_expansion.

## Change

Added `lollipop`, `dot`, `pareto`, and `polar` to the saved KPI visual union, chart selector catalogue, SVG renderer and animated hover previews. All use the existing category/one-measure schema; existing dashboard JSON remains compatible. Added a `sparkles` icon requested by root for the AI feature.

- Lollipop: horizontal category comparisons with stems from a shared zero baseline.
- Dot: horizontal comparisons without stems. Both support negative and zero values. More than 12 groups show the 12 largest with an explicit omitted-count message, rather than adding averages into a fabricated Other value.
- Pareto: descending positive contributions plus cumulative percentage line and independent right-hand percentage scale. More than 12 categories retain the largest 11 and combine remaining contributions as Other, with an explanatory note.
- Polar area: equal-angle sectors with radius equal to sqrt(value/max), so sector area represents value. A legend includes values and shares.
- Pareto/polar explain negative or all-zero inputs. Empty charts retain the existing empty-state message. New SVGs have fallback accessible names and data titles. Signed comparison geometry remains finite at numeric extremes.

## Owned and changed files

- src/app/core/models.ts (KpiVisual union only)
- src/app/dashboard/studio-model.ts
- src/app/dashboard/dashboard-model.ts
- src/app/dashboard/kpi-chart.ts
- src/app/dashboard/viz-preview.ts
- src/app/components/icon.ts
- src/app/dashboard/kpi-chart.spec.ts
- src/app/dashboard/studio-model.spec.ts

Corresponding originals, plus unchanged viz-preview.spec.ts, are under `.pm/backups/FEATURE-CHARTS/` with original relative paths.

## Verification

Command: `npx ng test --watch=false --include='src/app/dashboard/kpi-chart.spec.ts' --include='src/app/dashboard/studio-model.spec.ts' --include='src/app/dashboard/viz-preview.spec.ts'`

Result: 3 test files / 18 tests passed, final run 2026-11-08 17:55:51 local. Covers actual SVG content, signed/zero/non-finite and extreme values, top-12 disclosure, Pareto ordering and exact 100% endpoint with combined groups, polar radius-squared area proportions, negative/all-zero rejection, empty states, preview content for every type and saved-JSON round-trip.

Full integration test/build and native visual review remain with root. No new dependencies, native app relaunch or live data writes were performed. No independent UI acceptance is claimed.

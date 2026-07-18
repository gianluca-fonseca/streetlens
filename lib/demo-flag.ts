/**
 * The single switch that decides whether the mock/demo segment scores are shown
 * on the public site.
 *
 * `NEXT_PUBLIC_SHOW_DEMO_DATA` is read HERE and nowhere else, so the demo era is
 * one flag, not a scatter of `process.env` reads. Default OFF: unset (or anything
 * other than the exact string "true") hides every demo score. Real data
 * collection has started, so the generated pilot audits are preserved in the repo
 * but no longer published; with the flag off the 535 esc-sa pilot segments render
 * as part of the neutral, unaudited canton network, and the only colored data is
 * real community/CV observations.
 *
 * Read at call time (not a module-level constant) so a single process can
 * exercise both states in tests. In the Next bundle webpack still inlines the
 * `process.env.NEXT_PUBLIC_SHOW_DEMO_DATA` literal, so this works in server and
 * client components alike.
 */
export function showDemoData(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_DEMO_DATA === "true";
}

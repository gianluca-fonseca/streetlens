#!/usr/bin/env node
/**
 * test-ops-budget.mjs — session budget is frames × per-frame allowance.
 */

const frames = 100;
const perFrame = 4000;
const budget = Math.max(1, frames) * perFrame;
const used = 5000;
const remaining = Math.max(0, budget - used);

if (budget !== 400000) throw new Error("budget scale");
if (remaining !== budget - used) throw new Error("remaining");

console.log("test-ops-budget: ok");

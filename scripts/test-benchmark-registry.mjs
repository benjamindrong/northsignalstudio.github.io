import assert from 'node:assert/strict';
import { projectBenchmarkRegistry } from './benchmark-registry.mjs';

const registry = projectBenchmarkRegistry(`
## Benchmark Run Ledger

### BEN-13 — Crossmark X Handoff Benchmark
- Status: Selected — next
- Source: Crossmark CROS-1 Slice 2 handoff flow

### BEN-14 — Crossmark Physical Signal Hunt Field Benchmark
- Status: Blocked
- Source: Crossmark physical-device field testing

### BEN-15 — Follow-on benchmark preparation
- Status: Preparing
- Source: Benchmark Review

### BEN-11 — Crossmark Signal Hunt Benchmark
- Status: Completed
- Source: Crossmark CROS-1 Wild X hunt
`);

assert.equal(registry.state, 'ready');
assert.equal(registry.selectedNext?.key, 'BEN-13');
assert.equal(registry.runs.find(run => run.key === 'BEN-14')?.status, 'Blocked');
assert.equal(registry.runs.find(run => run.key === 'BEN-15')?.status, 'Preparing');
assert.equal(registry.runs.find(run => run.key === 'BEN-11')?.status, 'Completed');
assert.equal(
  registry.runs.filter(run => ['Preparing', 'Blocked', 'Running'].includes(run.status)).length,
  2,
  'selected-next and active-work state must remain independent'
);

console.log('benchmark registry active-state tests passed');

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { projectNativeReview, MAX_AGE_MS } = require('../dashboard/native-benchmark-review.js');
const root = new URL('../dashboard/native-benchmark-review.js', import.meta.url);
const source = readFileSync(root, 'utf8');
const p = '22222222-2222-4222-8222-222222222222';
const doneId = '11111111-1111-4111-8111-111111111111';
const nextId = '33333333-3333-4333-8333-333333333333';
const ideaId = '44444444-4444-4444-8444-444444444444';
const nativeId = '55555555-5555-4555-8555-555555555555';
const now = Date.parse('2026-10-10T15:00:00.000Z');
const record = (ticketId, lifecycle, additions={}) => ({
  ticketId, summary: lifecycle + ' Review', lifecycle,
  activityKind: lifecycle === 'Unused' ? null : 'candidate-evaluation',
  ideaCategory: lifecycle === 'Unused' ? 'fresh' : null,
  legacyDisplayKey: null, legacySourceKey: null, sourceTicketId: null,
  result: lifecycle === 'Completed' ? {kind:'summary',outcome:'Pass',scores:'10/10',signal:'Strong'} : null,
  notableFinding: lifecycle === 'Completed' ? 'Original finding' : null,
  completedAtEpochMillis: lifecycle === 'Completed' ? String(now-60_000) : null,
  ...additions,
});
const fixture = () => ({
  version:1,authority:'dashboard-native-benchmark-review',
  generatedAt:new Date(now).toISOString(),nativeProjectionSha256:'a'.repeat(64),
  registry:{projectId:p,selectedNextTicketId:nextId,selectedNextLegacyDisplayKey:null},
  records:[
    record(doneId,'Completed',{legacyDisplayKey:'BEN-99',legacySourceKey:'HOME-61'}),
    record(nextId,'Preparing'),
    record(ideaId,'Unused'),
    record(nativeId,'Running',{sourceTicketId:'66666666-6666-4666-8666-666666666666'}),
  ],
  completedOrder:[doneId],
});
const adapt = (value, expectedProjectId=p, clock=now) =>
  projectNativeReview(value,{expectedProjectId,now:clock});

const data = adapt(fixture());
assert.equal(data.authority,'dashboard-native-benchmark-review');
assert.equal(data.state,'ready');
assert.equal(data.selectedNext.key,'Native ticket: ' + nextId);
assert.equal(data.runs.find(r=>r.nativeTicketId===doneId).legacyDisplayKey,'BEN-99');
assert.deepEqual(data.completedOrder,['BEN-99']);
assert.deepEqual(data.runs.find(r=>r.nativeTicketId===doneId).resultLines,
  ['Outcome: Pass','Scores: 10/10','Signal: Strong']);
assert.equal(data.runs.find(r=>r.nativeTicketId===nativeId).legacyDisplayKey,null);
assert.equal(data.runs.find(r=>r.nativeTicketId===nativeId).source,
  'Native ticket: 66666666-6666-4666-8666-666666666666');
assert.equal(data.freshBacklog[0].ideas.length,1);
assert.equal(data.previouslyConsidered.length,0);
assert.equal(adapt(fixture(),p,now+MAX_AGE_MS).runs.length,3);
assert.throws(()=>adapt(fixture(),p,now+MAX_AGE_MS+1),/stale/i);
assert.throws(()=>adapt(fixture(),p,now-120_001),/future/i);
assert.throws(()=>projectNativeReview(fixture(),{now}),/approved project/i);
assert.throws(()=>adapt(fixture(),'77777777-7777-4777-8777-777777777777'),/project mismatch/i);
function mutation(fn){
 const value=fixture();fn(value);
 assert.throws(()=>adapt(value),/Invalid native Benchmark Review/);
}
mutation(v=>{v.authority='jira-native';});
mutation(v=>{v.nativeProjectionSha256='invalid';});
mutation(v=>{v.registry.selectedNextTicketId='77777777-7777-4777-8777-777777777777';});
mutation(v=>{v.completedOrder=[];});
mutation(v=>{v.completedOrder=[doneId,doneId];});
mutation(v=>{v.records[0].objective='Sensitive internal content';});
mutation(v=>{v.records[0].lifecycle='Running';});
mutation(v=>{v.records[0].result=null;});
mutation(v=>{v.records[2].ideaCategory=null;});
mutation(v=>{v.registry.selectedNextLegacyDisplayKey='BEN-99';});
mutation(v=>{v.records.push(v.records[0]);});
mutation(v=>{v.records[3].legacyDisplayKey='BEN-99';v.records[0].legacyDisplayKey='BEN-99';});
mutation(v=>{v.records[0].completedAtEpochMillis='not-a-time';});
const noSelected=fixture();noSelected.registry.selectedNextTicketId=null;
assert.equal(adapt(noSelected).selectedNext,null);
assert(!source.includes('fetch('), 'The adapter cannot directly read an external authority.');
assert(!source.includes('search/jql'), 'The native adapter must not implement JQL.');
console.log('PASS: native Benchmark Review web adapter identity, source, parity, freshness and fail-closed guards');

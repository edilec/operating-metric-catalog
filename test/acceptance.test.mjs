import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli=new URL('../bin/operating-metric-catalog.mjs',import.meta.url).pathname;
const metric=(id='orders')=>({id,definition:'Completed orders per local day',formula:'count(completed_order_id)',unit:'orders',grain:'day',owner:'private-owner',threshold:{operator:'min',value:'100'},decisionUse:'Capacity planning',reviewedAt:'2026-01-01'});
const good={schemaVersion:'1',asOf:'2026-01-02',reviewEveryDays:365,metrics:[metric()],dashboards:[{label:'Orders Today',metricId:'orders'}]};
function run(doc=good) {
  const root=mkdtempSync(join(tmpdir(),'metric-catalog-'));
  try {
    writeFileSync(join(root,'catalog.json'),typeof doc==='string'?doc:JSON.stringify(doc));
    const p=spawnSync(process.execPath,[cli,'--root',root,'--input','catalog.json'],{encoding:'utf8'});
    return {...p,report:p.stdout?JSON.parse(p.stdout):null};
  } finally { rmSync(root,{recursive:true,force:true}); }
}

test('good catalog passes and dashboard label cannot supply formula', async () => {
  const {TOOL_ID,validateCatalog}=await import('../src/index.mjs');
  assert.equal(TOOL_ID,'operating-metric-catalog');
  const a=run(),b=run();
  assert.equal(a.status,0);
  assert.equal(a.stdout,b.stdout);
  assert.equal(a.report.status,'pass');
  assert.equal(a.report.summary.checked,1);
  assert.deepEqual(a.report.findings,[]);
  assert.equal(validateCatalog(good).status,'pass');
  assert.doesNotMatch(a.stdout,/private-owner|Completed orders|count\(/);
});

test('duplicate metric identity is incomplete with source ordinal', () => {
  const d=structuredClone(good); d.metrics.push({...metric(),formula:'sum(order_count)'});
  const r=run(d);
  assert.equal(r.status,2);
  const duplicate=r.report.findings.find(f=>f.ruleId==='metric-id-duplicate');
  assert.equal(duplicate?.location.pointer,'/metrics/1');
});

test('ambiguous metric ID cannot support a dashboard formula comparison', () => {
  const d=structuredClone(good);
  d.metrics.push({...metric(),formula:'sum(other_value)'});
  d.dashboards[0].formula='sum(other_value)';
  const r=run(d);
  assert.equal(r.status,2);
  const ids=r.report.findings.map(f=>f.ruleId);
  assert.ok(ids.includes('metric-id-duplicate'));
  assert.ok(ids.includes('dashboard-metric-unknown'));
  assert.ok(!ids.includes('dashboard-formula-conflict'));
});

test('invalid duplicate metric also taints dashboard comparison', () => {
  const d=structuredClone(good);
  d.metrics.push({...metric(),formula:''});
  d.dashboards[0].formula='sum(other_value)';
  const r=run(d);
  assert.equal(r.status,2);
  const ids=r.report.findings.map(f=>f.ruleId);
  assert.ok(ids.includes('metric-invalid'));
  assert.ok(ids.includes('dashboard-metric-unknown'));
  assert.ok(!ids.includes('dashboard-formula-conflict'));
});

test('duplicate definition across distinct identities is a policy failure', () => {
  const d=structuredClone(good); d.metrics.push(metric('orders-copy'));
  const r=run(d);
  assert.equal(r.status,1);
  assert.equal(r.report.findings[0].ruleId,'definition-duplicate');
});

test('dashboard formula disagreement is reported without replacing catalog formula', () => {
  const d=structuredClone(good); d.dashboards[0].formula='sum(other_value)';
  const r=run(d);
  assert.equal(r.status,1);
  assert.equal(r.report.findings[0].ruleId,'dashboard-formula-conflict');
  assert.equal(r.report.findings[0].location.pointer,'/dashboards/0/formula');
  assert.doesNotMatch(r.stdout,/sum\(other_value\)|count\(completed_order_id\)/);
});

test('missing authoritative catalog formula is incomplete even if dashboard has one', () => {
  const d=structuredClone(good); delete d.metrics[0].formula; d.dashboards[0].formula='count(completed_order_id)';
  const r=run(d);
  assert.equal(r.status,2);
  const invalid=r.report.findings.find(f=>f.ruleId==='metric-invalid');
  assert.equal(invalid?.location.pointer,'/metrics/0');
});

test('exact metric record bound passes and N+1 is incomplete', () => {
  const d=structuredClone(good); d.metrics=Array.from({length:1000},(_,i)=>({...metric(`m${i}`),definition:`Definition ${i}`,formula:`count(field_${i})`})); d.dashboards=[];
  assert.equal(run(d).status,0);
  d.metrics.push(metric('extra'));
  const r=run(d);
  assert.equal(r.status,2);
  assert.equal(r.report.findings[0].ruleId,'record-limit');
});

test('exact dashboard record bound passes and N+1 is incomplete', () => {
  const d=structuredClone(good);d.dashboards=Array.from({length:1000},(_,i)=>({label:`Panel ${i}`,metricId:'orders'}));
  assert.equal(run(d).status,0);
  d.dashboards.push({label:'Extra panel',metricId:'orders'});
  const r=run(d);
  assert.equal(r.status,2);assert.equal(r.report.findings[0].ruleId,'record-limit');
});

test('input symlink escaping root is incomplete and never read', () => {
  const root=mkdtempSync(join(tmpdir(),'metric-root-')),outside=mkdtempSync(join(tmpdir(),'metric-out-'));
  try {
    writeFileSync(join(outside,'catalog.json'),'PRIVATE_SENTINEL');
    symlinkSync(join(outside,'catalog.json'),join(root,'catalog.json'));
    const p=spawnSync(process.execPath,[cli,'--root',root,'--input','catalog.json'],{encoding:'utf8'});
    assert.equal(p.status,2);
    assert.equal(JSON.parse(p.stdout).status,'incomplete');
    assert.doesNotMatch(p.stdout,/PRIVATE_SENTINEL/);
  } finally { rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true}); }
});

test('bad usage has empty stdout while bad subject has an incomplete report', () => {
  const bad=spawnSync(process.execPath,[cli,'--unknown'],{encoding:'utf8'});
  assert.equal(bad.status,2);assert.equal(bad.stdout,'');
  const root=mkdtempSync(join(tmpdir(),'metric-catalog-'));
  try {
    writeFileSync(join(root,'catalog.json'),Buffer.from([0xff]));
    const p=spawnSync(process.execPath,[cli,'--root',root,'--input','catalog.json'],{encoding:'utf8'});
    assert.equal(p.status,2);assert.equal(JSON.parse(p.stdout).status,'incomplete');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('packaged passing and failing examples exercise the CLI', () => {
  for(const [name,code] of [['passing.json',0],['failing.json',1]]) {
    const p=spawnSync(process.execPath,[cli,'--root',new URL('../examples/',import.meta.url).pathname,'--input',name],{encoding:'utf8'});
    assert.equal(p.status,code,p.stderr);
    assert.equal(JSON.parse(p.stdout).tool,'operating-metric-catalog');
  }
});

test('human summary goes to stderr while stdout remains JSON', () => {
  const p=spawnSync(process.execPath,[cli,'--root',new URL('../examples/',import.meta.url).pathname,'--input','passing.json','--human'],{encoding:'utf8'});
  assert.equal(p.status,0);
  assert.equal(JSON.parse(p.stdout).status,'pass');
  assert.match(p.stderr,/1 metrics evaluated/);
});

test('JSON depth 16 passes and depth 17 is incomplete', async () => {
  const {validateCatalog}=await import('../src/index.mjs');
  const nested=n=>{const d=structuredClone(good);let x=d;for(let i=0;i<n;i++){x.extra={};x=x.extra;}return d;};
  assert.equal(validateCatalog(nested(16)).status,'pass');
  const r=validateCatalog(nested(17));
  assert.equal(r.status,'incomplete');assert.equal(r.findings[0].ruleId,'depth-limit');
});

test('time bound accepts 5000 ms and rejects 5001 ms', async () => {
  const {validateCatalog}=await import('../src/index.mjs');
  const clock=values=>{let i=0;return()=>values[i++]??values.at(-1);};
  assert.equal(validateCatalog(good,clock([0,5000,5000])).status,'pass');
  const r=validateCatalog(good,clock([0,5001]));
  assert.equal(r.status,'incomplete');assert.equal(r.findings[0].ruleId,'time-limit');
});

test('review age exactly at its limit passes and one day later fails', () => {
  const d=structuredClone(good);d.reviewEveryDays=1;
  assert.equal(run(d).status,0);
  d.asOf='2026-01-03';
  const r=run(d);
  assert.equal(r.status,1);assert.equal(r.report.findings[0].ruleId,'review-overdue');
});

test('byte bound accepts exactly 1048576 and rejects the next byte', () => {
  const base=JSON.stringify(good);
  const exact=base+' '.repeat(1_048_576-Buffer.byteLength(base));
  assert.equal(run(exact).status,0);
  const over=run(exact+' ');
  assert.equal(over.status,2);
  assert.equal(over.report.findings[0].ruleId,'byte-limit');
});

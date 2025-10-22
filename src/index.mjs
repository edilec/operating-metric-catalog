export const TOOL_ID='operating-metric-catalog';
export const LIMITS=Object.freeze({bytes:1_048_576,records:1000,depth:16,milliseconds:5000});
const SEVERITY=Object.freeze({
  'input-unreadable':'warning','input-invalid':'warning','byte-limit':'warning','record-limit':'warning','depth-limit':'warning','time-limit':'warning',
  'no-metrics':'warning','metric-invalid':'warning','metric-id-duplicate':'warning','dashboard-invalid':'warning','dashboard-metric-unknown':'warning',
  'definition-duplicate':'error','definition-conflict':'error','dashboard-formula-conflict':'error','dashboard-label-conflict':'error','review-overdue':'error'
});
const INCOMPLETE=new Set(Object.keys(SEVERITY).filter(k=>SEVERITY[k]==='warning'));
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const usable=x=>typeof x==='string'&&x.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\p{Cf}]/gu,'').trim().length>0;
const day=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(`${x}T00:00:00Z`))&&new Date(`${x}T00:00:00Z`).toISOString().slice(0,10)===x;
const decimal=x=>typeof x==='string'&&/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(x);
const messages={
  'input-unreadable':'Input could not be read, decoded, or parsed.','input-invalid':'Expected a supported version 1 catalog.',
  'byte-limit':'Input exceeds 1048576 bytes.','record-limit':'Metric or dashboard records exceed 1000.','depth-limit':'JSON nesting exceeds depth 16.','time-limit':'Evaluation exceeded 5000 milliseconds.',
  'no-metrics':'Catalog contains no metrics.','metric-invalid':'Metric lacks a usable required definition field.','metric-id-duplicate':'Metric ID is duplicated and its definition is ambiguous.',
  'dashboard-invalid':'Dashboard reference lacks a usable label or metric ID.','dashboard-metric-unknown':'Dashboard references an unavailable catalog metric.',
  'definition-duplicate':'Two metric IDs carry the same complete definition.','definition-conflict':'A definition label is attached to conflicting formulas, units, or grains.',
  'dashboard-formula-conflict':'Dashboard formula differs from the authoritative catalog formula.','dashboard-label-conflict':'Dashboard label maps to multiple catalog metrics.',
  'review-overdue':'Metric review age exceeds the configured interval.'
};
function finding(ruleId,pointer='') {
  if(!Object.hasOwn(SEVERITY,ruleId)) throw new Error('unknown rule');
  return {ruleId,severity:SEVERITY[ruleId],message:messages[ruleId],location:{file:'@input',pointer}};
}
function report(findings,checked=0,extra={}) {
  findings.sort((a,b)=>cmp(a.location.file,b.location.file)||cmp(a.location.pointer,b.location.pointer)||cmp(a.ruleId,b.ruleId));
  const status=findings.some(f=>INCOMPLETE.has(f.ruleId))?'incomplete':findings.some(f=>f.severity==='error')?'fail':'pass';
  return {schemaVersion:'1',tool:TOOL_ID,status,summary:{checked,errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length,...extra},findings};
}
export function incomplete(ruleId) { return report([finding(ruleId)]); }
function tooDeep(value,depth=0) {
  if(depth>LIMITS.depth) return true;
  if(!value||typeof value!=='object') return false;
  return Object.values(value).some(v=>tooDeep(v,depth+1));
}
export function validateCatalog(doc,now=()=>performance.now()) {
  const start=now(), findings=[];
  if(!obj(doc)||doc.schemaVersion!=='1'||!day(doc.asOf)||!Number.isSafeInteger(doc.reviewEveryDays)||doc.reviewEveryDays<1||doc.reviewEveryDays>3650||!Array.isArray(doc.metrics)||!Array.isArray(doc.dashboards)) return report([finding('input-invalid')]);
  if(tooDeep(doc)) return report([finding('depth-limit')]);
  if(doc.metrics.length>LIMITS.records||doc.dashboards.length>LIMITS.records) return report([finding('record-limit')]);
  if(!doc.metrics.length) return report([finding('no-metrics','/metrics')]);
  const byId=new Map(), ambiguousIds=new Set(), byDefinition=new Map();
  let checked=0;
  for(const [i,m] of doc.metrics.entries()) {
    if(now()-start>LIMITS.milliseconds) return report([finding('time-limit')]);
    const pointer=`/metrics/${i}`;
    if(!obj(m)||!['id','definition','formula','unit','grain','owner','decisionUse'].every(k=>usable(m[k]))||!day(m.reviewedAt)||!obj(m.threshold)||!['min','max'].includes(m.threshold.operator)||!decimal(m.threshold.value)||m.reviewedAt>doc.asOf) {if(obj(m)&&usable(m.id)) ambiguousIds.add(m.id);findings.push(finding('metric-invalid',pointer));continue;}
    checked++;
    if(byId.has(m.id)) {ambiguousIds.add(m.id);findings.push(finding('metric-id-duplicate',pointer));continue;}
    byId.set(m.id,m);
    const previous=byDefinition.get(m.definition);
    if(previous) findings.push(finding(previous.formula===m.formula&&previous.unit===m.unit&&previous.grain===m.grain?'definition-duplicate':'definition-conflict',pointer));
    else byDefinition.set(m.definition,m);
    const age=(Date.parse(`${doc.asOf}T00:00:00Z`)-Date.parse(`${m.reviewedAt}T00:00:00Z`))/86400000;
    if(age>doc.reviewEveryDays) findings.push(finding('review-overdue',`${pointer}/reviewedAt`));
  }
  const labels=new Map();
  for(const [i,d] of doc.dashboards.entries()) {
    if(now()-start>LIMITS.milliseconds) return report([finding('time-limit')]);
    const pointer=`/dashboards/${i}`;
    if(!obj(d)||!usable(d.label)||!usable(d.metricId)||(d.formula!==undefined&&!usable(d.formula))) {findings.push(finding('dashboard-invalid',pointer));continue;}
    if(labels.has(d.label)&&labels.get(d.label)!==d.metricId) findings.push(finding('dashboard-label-conflict',`${pointer}/label`));
    else labels.set(d.label,d.metricId);
    const m=byId.get(d.metricId);
    if(!m||ambiguousIds.has(d.metricId)) {findings.push(finding('dashboard-metric-unknown',`${pointer}/metricId`));continue;}
    if(d.formula!==undefined&&d.formula!==m.formula) findings.push(finding('dashboard-formula-conflict',`${pointer}/formula`));
  }
  return report(findings,checked,{dashboards:doc.dashboards.length});
}

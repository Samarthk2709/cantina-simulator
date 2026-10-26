// Pacing check: a scripted, reasonable player (hunts by hand, teaches well, proves Nib's finds, buys the rig first).
// Run: node work/stage2/tests/pacing.cjs  — fails if the stage gets too short, too long, or Nib stops mattering.
const assert = require('node:assert/strict');
const D=require('../data.js');
const E=require('../engine.js');
function run(seed,{missRate=0.4,greedyRaw=false}={}){
  const s=E.create({},seed);let rng=seed;const R=()=>{rng=(rng*1103515245+12345)>>>0;return rng/4294967296;};
  const order=['chat','inv','vault','bank'];let actions=0;
  const goodAll=fid=>D.SECTIONS.forEach(x=>{if(!(x.id==='proof'&&s.found[fid].source==='nib'&&!s.found[fid].proven))E.setSection(s,fid,x.id,0)});
  for(let day=0;day<60&&!s.won;day++){
    if(!s.target)E.takeJob(s,'chat');
    for(let guard=0;guard<80&&!s.won;guard++){
      // shop
      if(s.gpu<3&&s.cash>=D.RIGS[s.gpu+1].cost-D.RIGS[s.gpu].cost+100) E.setRig(s,s.gpu+1);
      for(const t of ['fuzz','dbg','trace']) if(!E.has(s,t)&&s.cash>=D.TOOLS.find(x=>x.id===t).cost+200) E.buyTool(s,t);
      if(s.gpu<3&&s.cash>=D.RIGS[s.gpu+1].cost-D.RIGS[s.gpu].cost+400) E.setRig(s,s.gpu+1);
      for(const t of order) if(E.chainState(s,t).ready) {E.trace(s,t,0);actions++;}
      if(s.tray.length){const c=s.tray[0];
        if(!greedyRaw&&s.focus>=15){const r=E.prove(s,c.id);if(r.real){goodAll(r.fid);E.submit(s,r.fid);}}
        else if(c.conf>=50||greedyRaw){const r=E.submitRaw(s,c.id);if(r.real&&!r.accepted){goodAll(r.fid);E.submit(s,r.fid);}}
        else E.toss(s,c.id);
        actions++;continue;}
      const drafts=Object.keys(s.found).filter(f=>s.found[f].status==='draft');
      if(drafts.length){goodAll(drafts[0]);E.submit(s,drafts[0]);continue;}
      const t=s.target;
      const open=s.lit[t].flatMap(r=>E.roomFindings(t,r)).filter(f=>E.slotState(s,f)==='open');
      if(open.length&&s.focus>=16){const fid=open[0],f=E.FINDINGS[fid],L=D.CLASSES[f.cls].variants[f.variant];
        if(R()<missRate)E.guess(s,fid,L.findIndex(l=>!l.bad));
        const r=E.guess(s,fid,L.findIndex(l=>l.bad));if(!r.hit)continue;
        if(s.pendingTeach)E.teach(s,'sharp');goodAll(fid);E.submit(s,fid);actions+=3;continue;}
      const mappable=D.TARGETS.find(x=>x.id===t).rooms.map(r=>r[0]).filter(r=>E.canMap(s,t,r));
      if(!open.length&&mappable.length&&s.focus>=10){E.mapRoom(s,mappable[0]);actions++;continue;}
      if(!open.length&&!mappable.length){const left=s.lit[t].flatMap(r=>E.roomFindings(t,r)).filter(f=>['open','tray','locked'].includes(E.slotState(s,f)));
        if(!left.length||left.every(f=>E.slotState(s,f)==='locked')){const nx=order.find(x=>x!==t&&E.canTake(s,x).ok&&!(s.lit[x]&&s.lit[x].length===6&&D.TARGETS.find(z=>z.id===x).rooms.flatMap(r=>E.roomFindings(x,r[0])).every(f=>E.slotState(s,f)!=='open')));if(nx&&nx!==t){E.takeJob(s,nx);continue;}}}
      if(s.focus<16&&s.cups&&E.coffee(s).ok)continue;
      break;
    }
    if(s.won)break;
    E.sleep(s);
  }
  return {won:s.won,day:s.day,bugs:s.bugs,crits:s.crits,manual:s.stats.manual,nib:s.stats.nib,cash:s.cash,rep:s.rep,gpu:s.gpu,tools:s.tools.join(','),chains:Object.keys(s.chains).join(',')};
}
const res=[];for(let i=1;i<=40;i++)res.push(run(i*977));
const days=res.map(r=>r.day).sort((a,b)=>a-b), manual=res.reduce((a,r)=>a+r.manual,0)/40, nib=res.reduce((a,r)=>a+r.nib,0)/40;
console.log('won',res.filter(r=>r.won).length+'/40','· median day',days[20],'· range',days[0]+'-'+days[39],'· by hand',manual.toFixed(1),'· by Nib',nib.toFixed(1));
assert.equal(res.filter(r=>r.won).length,40,'every run finishes');
assert.ok(days[20]>=4&&days[20]<=9,'median length 4-9 days');
assert.ok(nib/(nib+manual)>=0.3,'Nib finds at least 30% of bugs');

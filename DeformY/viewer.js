// 3D swing replay — ropeviz viewer (imported from v9_single_example_19dirs)
// with the ten A–J swings from ghost_sequence_v5, plus live policy runs.
//
// The floating panel (top-right of the viewport) holds a 4-D goal — x, y, z and
// the arrival angle, in the Browse convention (+90° = +x, 0° = up; the policy's
// in-plane theta is its negative) — and Run, which plans that goal with the
// Stage B policy on the inference server (viz/infer/server.py, the same code
// path as export_real_traj.py --from policy) and adds the result to Browse.
// Without a reachable server, Run stays disabled; nothing is faked.
// `guides` (the one option, on the timeline row) toggles the keep-out plane,
// the workspace (assets/viewer/workspace.json, from ropeswing.goals), the axes
// and the full target drawing; off, a target is just a point and a vector.
(async()=>{
 const section=document.getElementById('swings');
 const get=u=>fetch(u).then(r=>{if(!r.ok)throw Error(u);return r.json();});
 try{
  const [arm,swings]=await Promise.all(['assets/viewer/arm.json','assets/viewer/swings.json'].map(get));
  const ws=await get('assets/viewer/workspace.json').catch(()=>null);
  const cfg=await get('demo-config.json').catch(()=>({}));
  const API=(cfg&&typeof cfg.inference==='string')?cfg.inference.replace(/\/$/,''):'';
  DY.setArm(arm);
  // The viewer reads the canvas height attribute once at construction.
  const cv=document.getElementById('swing-view');
  if(window.innerWidth<760)cv.setAttribute('height','360');
  const samples=swings.map(s=>({...s.sample,label:`Traj ${s.key}`,goals:(s.sample.goals||[]).map(g=>({...g,label:null}))}));
  samples.forEach(s=>{s._g=s.goals;});
  const vw=DY.player('swing-view',{
   samples,
   world:{grid:{z:0,x0:-1.8,x1:1.8,y0:0,y1:3,step:.5},wall:{y:0,x0:-1.8,x1:1.8,z0:0,z1:2.9},
          plane:ws?ws.plane:null,paths:ws?ws.paths:[]},
   speed:.5,trail:36,autoplay:true,fit:true,picker:false,layer_ui:false,group_ui:false,
   layers:{axes:false,plane:false,labels:false},groups:{workspace:false}});
  const host=document.getElementById('swing-picker');
  const note=document.getElementById('swing-note');
  const angle=a=>`${a<0?'−':'+'}${Math.abs(Math.round(a))}°`;
  const R2D=180/Math.PI,D2R=Math.PI/180,fx=(v,n)=>(v===null||v===undefined||!isFinite(v))?'—':(+v).toFixed(n);
  const runs=[];                                   // live results, after the ten swings

  // ---- the 4-D goal frame (mirror of ropeswing.theta; zh = target -> base)
  const frameAt=p=>{const zh=DY.nrm(DY.sub(DY.arm().base_pos,p));
   const xh=DY.nrm(DY.sub([0,0,1],DY.scl(zh,zh[2])));return{zh,xh,yh:DY.cross(zh,xh)};};
  const dstar=(p,th)=>{const F=frameAt(p);return DY.add(DY.scl(F.xh,Math.cos(th)),DY.scl(F.yh,Math.sin(th)));};
  const thetaOf=(v,p)=>{const F=frameAt(p);return Math.atan2(DY.dot3(v,F.yh),DY.dot3(v,F.xh));};
  const G={p:[0,2,1.5],th:0,d:[0,0,1]};             // the panel's goal; th = policy theta
  const setGoal=(p,th)=>{if(p)G.p=p.slice();if(th!==undefined)G.th=Math.atan2(Math.sin(th),Math.cos(th));G.d=dstar(G.p,G.th);};

  // ---- guides: keep-out plane, workspace, axes, full target drawing
  let guides=false;
  try{guides=localStorage.getItem('pisi.guides')==='1';}catch(e){}
  function setGuides(on){
   guides=!!on;vw.layers.plane=guides;vw.layers.axes=guides;vw.groups.workspace=guides;
   vw.samples.forEach(s=>{s.goals=guides?s._g:[];});
   gbtn.classList.toggle('on',guides);
   try{localStorage.setItem('pisi.guides',guides?'1':'0');}catch(e){}
   syncHandles();vw.draw();
  }
  const row=document.querySelector('#swing-view-ui .dy-row');
  const spd=row&&row.querySelector('select');if(spd)spd.remove();   // not an option here
  const gbtn=document.createElement('button');
  gbtn.className='sl-guides';gbtn.textContent='guides';
  gbtn.title='keep-out plane · workspace · axes · full target drawing';
  gbtn.onclick=()=>setGuides(!guides);
  if(row)row.appendChild(gbtn);

  // ---- the floating panel
  const card=cv.parentElement;card.classList.add('sl-vcard');
  const fl=document.createElement('div');fl.className='sl-float';
  fl.innerHTML='<div class="sl-in">'+[['x','m'],['y','m'],['z','m'],['angle','°']].map(([k,u])=>
   `<label><span>${k}</span><input id="sl-${k}" type="number" step="${k==='angle'?5:0.05}"><i>${u}</i></label>`).join('')+'</div>'
   +'<button id="sl-run" class="sl-run" disabled>Run</button><p id="sl-msg" class="sl-msg"></p>'
   +'<table id="sl-res" class="sl-res"></table>';
  card.appendChild(fl);
  const $=id=>document.getElementById(id);
  const inp={x:$('sl-x'),y:$('sl-y'),z:$('sl-z'),angle:$('sl-angle')};
  function paintInputs(){
   const put=(k,v)=>{if(document.activeElement!==inp[k])inp[k].value=v;};
   put('x',G.p[0].toFixed(3));put('y',G.p[1].toFixed(3));put('z',G.p[2].toFixed(3));put('angle',(-G.th*R2D).toFixed(1));
  }
  Object.entries(inp).forEach(([k,el])=>el.addEventListener('change',()=>{
   const v=+el.value;if(!isFinite(v))return;
   if(k==='angle')setGoal(null,-v*D2R);else{const p=G.p.slice();p['xyz'.indexOf(k)]=v;setGoal(p);}
   syncHandles();paintResult();vw.draw();}));

  // the goal as handles: the T ball (position) and the ball on its arrow (angle)
  function syncHandles(){
   vw.handles=[{id:'goal',p:G.p.slice(),color:'--goal',r:7,label:'T'},
               {id:'gdir',p:DY.add(G.p,DY.scl(G.d,0.35)),color:'--goal',r:5,label:''}];
  }
  vw.onhandle=(id,p,phase)=>{
   if(id==='goal'&&p)setGoal(p);
   else if(id==='gdir'&&p){const v=DY.sub(p,G.p);if(Math.hypot(...v)>1e-4)setGoal(null,thetaOf(v,G.p));}
   syncHandles();paintInputs();if(phase==='end')paintResult();
  };
  vw.hooks.push(V=>{if(!guides)V.arrow(G.p,DY.add(G.p,DY.scl(G.d,0.35)),'--goal',2);});

  // ---- results: the current sample's, when it is a live run
  const same=(r)=>r&&Math.abs(r.p[0]-G.p[0])+Math.abs(r.p[1]-G.p[1])+Math.abs(r.p[2]-G.p[2])<1e-9&&Math.cos(r.th-G.th)>1-1e-12;
  function paintResult(){
   const r=runs[vw.cur-swings.length],t=$('sl-res');
   if(!r){t.innerHTML='';return;}
   const m=r.m,b={r0:5,psi0:10,v0:1};
   const tag=(ok,s)=>`<span class="${ok?'ok':'bad'}">${s}</span>`;
   t.innerHTML=[['result',tag(m.hit,m.hit?'HIT':'MISS')+(same(r)?'':' <em>stale</em>')],
    ['position error',tag(m.miss_cm<=b.r0,fx(m.miss_cm,1)+' cm')],
    ['angle error',tag(m.psi_deg<=b.psi0,fx(m.psi_deg,1)+'°')],
    ['speed',tag(m.s_d>=b.v0,fx(m.s_d,2)+' m/s')]].map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('');
  }

  // ---- Browse: the ten swings, then every live run
  const btns=[];
  function addButton(label,i,title){
   const b=document.createElement('button');b.textContent=label;b.title=title||'';
   b.onclick=()=>vw.setSample(i);host.appendChild(b);btns.push(b);return b;
  }
  swings.forEach((s,i)=>addButton(`Traj ${s.key}`,i,s.sample.note||''));
  function mark(i){
   btns.forEach((b,k)=>b.classList.toggle('on',k===i));
   const r=runs[i-swings.length];
   if(r){setGoal(r.p,r.th);note.textContent=`Run ${i-swings.length+1} — target (${r.p.map(v=>v.toFixed(2)).join(', ')}) m, arrival ${angle(-r.th*R2D)} · ${vw.samples[i].note}`;}
   else{const s=swings[i],g=s.sample.goals[0];
    setGoal(g.p,thetaOf(g.d,g.p));
    note.textContent=`Traj ${s.key} — target (${g.p.map(v=>v.toFixed(1)).join(', ')}) m, arrival ${angle(s.angle)} · ${s.sample.note}`;}
   syncHandles();paintInputs();paintResult();
  }
  const prev=vw.onsample;vw.onsample=i=>{if(prev)prev(i);mark(i);};

  // ---- Run: the inference server (same origin unless demo-config.json names one)
  const api=(path,body)=>fetch(API+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
   .then(r=>r.ok?r.json():r.json().catch(()=>({})).then(j=>{throw Error(j.error||r.status+'');}));
  const run=$('sl-run'),msg=$('sl-msg');let online=false,busy=false,idle='';
  const say=s=>{msg.textContent=s;};
  const poll=id=>new Promise((ok,no)=>{const tick=()=>api('/api/job/'+id).then(j=>{
   if(j.state==='done')return ok(j.result);if(j.state==='error')return no(Error(j.error));
   say((j.progress||j.state)+'…');setTimeout(tick,250);}).catch(no);tick();});
  const every=(a,k)=>a.filter((_,i)=>i%k===0||i===a.length-1);
  run.onclick=()=>{
   if(!online||busy)return;busy=true;run.disabled=true;run.textContent='Running…';say('');
   const goal={p:G.p.slice(),th:G.th,d:G.d.slice()};
   api('/api/infer',{goal:{p:goal.p,d:goal.d}}).then(j=>poll(j.id)).then(r=>{
    const m=r.metrics,n=runs.length+1;
    const gl={p:goal.p,d:r.goal.dstar,axis:r.goal.zh,tol:.05,tol_deg:10,
              achieved_d:r.pass_dir||undefined,achieved_ok:!!m.hit};
    // 60 Hz -> 30 Hz, the ten swings' rate, so every sample plays at one speed
    const s={label:`Run ${n}`,dt:1/30,q:every(r.q,2),rope:every(r.rope,2),color:'--wire',
             tone:m.hit?'good':'bad',goals:[gl],
             note:`M ${fx(m.M,2)} · miss ${fx(m.miss_cm,1)} cm · in-plane ${fx(m.psi_deg,2)}° · s_d ${fx(m.s_d,2)} m/s (${m.hit?'hit':'miss'})`
                 +(m.exported?'':' · rejected by the export gates')};
    s._g=s.goals;if(!guides)s.goals=[];
    runs.push({p:goal.p,th:goal.th,m});
    vw.samples.push(s);
    addButton(`Run ${n}`,vw.samples.length-1,s.note).classList.add('sl-runbtn');
    vw.setSample(vw.samples.length-1);
    if(vw.setPlaying)vw.setPlaying(true);
   }).catch(e=>say('Run failed: '+e.message)).finally(()=>{busy=false;run.disabled=!online;run.textContent='Run';if(!msg.textContent.startsWith('Run failed'))say(idle);});
  };
  api('/api/health').then(h=>{
   online=!!h.ready;run.disabled=!online;
   idle=!online?'policy offline':(h.model&&!h.model.record?`model: ${h.model.key} stand-in`:'');say(idle);
  }).catch(()=>{idle='policy offline';say(idle);});

  setGuides(guides);
  mark(0);
 }catch(e){
  const note=section&&section.querySelector('#swing-note');
  if(note)note.textContent='The 3D replay could not be loaded. Serve the site over HTTP (python3 -m http.server) so the viewer data can be fetched.';
 }
})();

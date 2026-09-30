// 3D swing replay — ropeviz viewer (imported from v9_single_example_19dirs)
// with the ten A–J swings from ghost_sequence_v5 as the only Browse options.
(async()=>{
 const section=document.getElementById('swings');
 try{
  const [arm,swings]=await Promise.all(['assets/viewer/arm.json','assets/viewer/swings.json'].map(u=>fetch(u).then(r=>{if(!r.ok)throw Error(u);return r.json();})));
  DY.setArm(arm);
  // The viewer reads the canvas height attribute once at construction.
  const cv=document.getElementById('swing-view');
  if(window.innerWidth<760)cv.setAttribute('height','360');
  const vw=DY.player('swing-view',{
   samples:swings.map(s=>({...s.sample,label:`Traj ${s.key}`,goals:(s.sample.goals||[]).map(g=>({...g,label:null}))})),
   world:{grid:{z:0,x0:-1.8,x1:1.8,y0:0,y1:3,step:.5},wall:{y:0,x0:-1.8,x1:1.8,z0:0,z1:2.9},plane:null},
   speed:.5,trail:36,autoplay:true,fit:true,picker:false,layers:{axes:true},
   layer_keys:['mesh','trail','path','goals','wall','grid','axes']});
  const host=document.getElementById('swing-picker');
  const note=document.getElementById('swing-note');
  const angle=a=>`${a<0?'−':'+'}${Math.abs(a)}°`;
  const btns=swings.map((s,i)=>{
   const b=document.createElement('button');
   b.textContent=`Traj ${s.key}`;
   b.title=s.sample.note||'';
   b.onclick=()=>vw.setSample(i);
   host.appendChild(b);return b;});
  function mark(i){
   btns.forEach((b,k)=>b.classList.toggle('on',k===i));
   const s=swings[i],p=s.sample.goals[0].p;
   note.textContent=`Traj ${s.key} — target (${p.map(v=>v.toFixed(1)).join(', ')}) m, arrival ${angle(s.angle)} · ${s.sample.note}`;
  }
  const prev=vw.onsample;vw.onsample=i=>{if(prev)prev(i);mark(i);};
  mark(0);
 }catch(e){
  const note=section&&section.querySelector('#swing-note');
  if(note)note.textContent='The 3D replay could not be loaded. Serve the site over HTTP (python3 -m http.server) so the viewer data can be fetched.';
 }
})();

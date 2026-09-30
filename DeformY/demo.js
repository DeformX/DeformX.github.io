(()=>{
 const plane=document.getElementById('target-plane');
 const marker=document.getElementById('target-marker');
 const pointer=document.getElementById('direction-pointer');
 const controls=Object.fromEntries(['u','v','depth','angle'].map(k=>[k,document.getElementById('target-'+k)]));
 const button=document.getElementById('generate-swing');
 const status=document.getElementById('demo-state');
 const video=document.getElementById('demo-video');
 const empty=document.getElementById('replay-empty');
 const result=document.getElementById('demo-result');
 let endpoint=null,busy=false;
 const values=()=>Object.fromEntries(Object.entries(controls).map(([k,input])=>[k,Number(input.value)]));
 function update(){const v=values();marker.style.left=v.u+'%';marker.style.top=(100-v.v)+'%';pointer.style.transform=`rotate(${-v.angle}deg)`;Object.entries(v).forEach(([k,n])=>document.getElementById('target-'+k+'-value').textContent=n+(k==='angle'?'°':'%'));if(!busy){video.hidden=true;video.removeAttribute('src');video.load();empty.hidden=false;result.textContent='';if(endpoint)status.textContent='Ready to generate the selected goal.';}}
 Object.values(controls).forEach(c=>c.addEventListener('input',update));
 plane.addEventListener('click',e=>{if(busy)return;const r=plane.getBoundingClientRect();controls.u.value=Math.round(Math.max(0,Math.min(100,100*(e.clientX-r.left)/r.width)));controls.v.value=Math.round(Math.max(0,Math.min(100,100*(1-(e.clientY-r.top)/r.height))));update();});
 function safeUrl(value){if(typeof value!=='string')throw Error('The service did not return a replay video.');const u=new URL(value,location.href);if(!['http:','https:'].includes(u.protocol))throw Error('Unsupported replay URL.');return u.href;}
 button.addEventListener('click',async()=>{if(!endpoint||busy)return;busy=true;button.disabled=true;Object.values(controls).forEach(c=>c.disabled=true);status.textContent='Generating candidates and running the simulator…';result.textContent='';const v=values();const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),180000);
 try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:{u:v.u/100,v:v.v/100,depth:v.depth/100,coordinate_system:'normalized_workspace'},arrival_angle_deg:v.angle,candidates:64}),signal:abort.signal});const data=await response.json();if(!response.ok)throw Error(data.message||'The simulation service could not complete this request.');if(data.reachable===false)throw Error(data.message||'This target is outside the reachable workspace. Please select another point.');video.src=safeUrl(data.video_url);video.hidden=false;empty.hidden=true;const details=[];if(Number.isFinite(data.position_error_cm))details.push(`Position error: ${data.position_error_cm.toFixed(1)} cm`);if(Number.isFinite(data.arrival_error_deg))details.push(`Arrival-angle error: ${data.arrival_error_deg.toFixed(1)}°`);result.textContent=details.join(' · ');status.textContent='Simulation complete. Play the generated strike below.';}
 catch(e){status.textContent=e.name==='AbortError'?'Simulation timed out. Please try again.':e.message;}
 finally{clearTimeout(timeout);busy=false;button.disabled=false;Object.values(controls).forEach(c=>c.disabled=false);}
 });
 video.addEventListener('error',()=>{if(video.getAttribute('src'))status.textContent='The replay could not be loaded. Please generate it again.';});
 fetch('demo-config.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(c=>{if(!c.endpoint)return;endpoint=safeUrl(c.endpoint);button.disabled=false;status.textContent='Ready to generate the selected goal.';document.querySelector('.demo-notice').textContent='Select a goal to generate a simulated strike. Results are from simulation, not a real robot.';}).catch(()=>{status.textContent='Simulation configuration unavailable. Target selection still works.';});
 update();
})();

(()=>{
 const controls=Object.fromEntries(['x','y','z','angle'].map(k=>[k,document.getElementById('target-'+k)]));
 const button=document.getElementById('generate-swing');
 const status=document.getElementById('demo-state');
 const video=document.getElementById('demo-video');
 const empty=document.getElementById('replay-empty');
 const result=document.getElementById('demo-result');
 let endpoint=null,busy=false;
 const values=()=>Object.fromEntries(Object.entries(controls).map(([k,input])=>[k,Number(input.value)]));
 const scene=Workspace3D.create(document.getElementById('target-space'),p=>{if(busy)return;['x','y','z'].forEach((k,i)=>controls[k].value=p[i].toFixed(2));update();});
 document.getElementById('reset-workspace').addEventListener('click',()=>scene.reset());
 function update(){const v=values(),p=[v.x,v.y,v.z],inside=Workspace3D.contains(p);scene.set(p,v.angle);Object.entries(v).forEach(([k,n])=>document.getElementById('target-'+k+'-value').textContent=k==='angle'?n+'°':n.toFixed(2)+' m');const region=document.getElementById('workspace-state');region.textContent=inside?'Inside task region':'Outside task region — move the target into the turquoise volume.';region.classList.toggle('outside',!inside);button.disabled=busy||!endpoint||!inside;if(!busy){video.hidden=true;video.removeAttribute('src');video.load();empty.hidden=false;result.textContent='';if(endpoint)status.textContent=inside?'Ready to generate the selected goal.':'Select a target inside the task region.';}}
 Object.values(controls).forEach(c=>c.addEventListener('input',update));
 function safeUrl(value){if(typeof value!=='string')throw Error('The service did not return a replay video.');const u=new URL(value,location.href);if(!['http:','https:'].includes(u.protocol))throw Error('Unsupported replay URL.');return u.href;}
 button.addEventListener('click',async()=>{if(!endpoint||busy||!Workspace3D.contains([values().x,values().y,values().z]))return;busy=true;scene.enable(false);button.disabled=true;Object.values(controls).forEach(c=>c.disabled=true);status.textContent='Generating candidates and running the simulator…';result.textContent='';const v=values();const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),180000);
 try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:{x:v.x,y:v.y,z:v.z,coordinate_system:'world_meters'},arrival_direction:Workspace3D.direction([v.x,v.y,v.z],v.angle),arrival_angle_deg:v.angle,candidates:64}),signal:abort.signal});const data=await response.json();if(!response.ok)throw Error(data.message||'The simulation service could not complete this request.');if(data.reachable===false)throw Error(data.message||'This target is outside the reachable workspace. Please select another point.');video.src=safeUrl(data.video_url);video.hidden=false;empty.hidden=true;const details=[];if(Number.isFinite(data.position_error_cm))details.push(`Position error: ${data.position_error_cm.toFixed(1)} cm`);if(Number.isFinite(data.arrival_error_deg))details.push(`Arrival-angle error: ${data.arrival_error_deg.toFixed(1)}°`);result.textContent=details.join(' · ');status.textContent='Simulation complete. Play the generated strike below.';}
 catch(e){status.textContent=e.name==='AbortError'?'Simulation timed out. Please try again.':e.message;}
 finally{clearTimeout(timeout);busy=false;scene.enable(true);button.disabled=!Workspace3D.contains([values().x,values().y,values().z]);Object.values(controls).forEach(c=>c.disabled=false);}
 });
 video.addEventListener('error',()=>{if(video.getAttribute('src'))status.textContent='The replay could not be loaded. Please generate it again.';});
 fetch('demo-config.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(c=>{if(!c.endpoint)return;endpoint=safeUrl(c.endpoint);update();document.querySelector('.demo-notice').textContent='Select a goal to generate a simulated strike. Results are from simulation, not a real robot.';}).catch(()=>{status.textContent='Simulation configuration unavailable. Target selection still works.';});
 update();
})();

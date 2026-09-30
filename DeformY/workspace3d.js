// Mirrors DeformY flow_matching/ropeswing/{goals,rig,theta}.py.
// World coordinates in metres; the task region is not a success guarantee.
window.Workspace3D = (() => {
  const base = [0, 0, 1.7], dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
  const add = (a,b) => a.map((v,i)=>v+b[i]), sub = (a,b)=>a.map((v,i)=>v-b[i]);
  const mul = (a,s)=>a.map(v=>v*s), unit=a=>mul(a,1/Math.hypot(...a));
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function contains(p) { const d=sub(p,base), r=Math.hypot(...d); return r>=1.6-1e-9 && r<=2.3+1e-9 && p[2]>=.3-1e-9 && p[2]<=2.5+1e-9 && d[1]/r>=Math.cos(Math.PI/6)-1e-9; }
  function direction(p,angle) { const z=unit(sub(base,p)), x=unit(sub([0,0,1],mul(z,z[2]))), y=cross(z,x), t=angle*Math.PI/180; return add(mul(x,Math.cos(t)),mul(y,Math.sin(t))); }
  function create(canvas, onMove) {
    const ctx=canvas.getContext('2d'); let w=600,h=420,yaw=.72,pitch=.35,zoom=.82,point=[0,1.95,1.7],angle=0,drag=null,enabled=true;
    const focus=[0,1.35,1.4], axes=[[1,0,0],[0,1,0],[0,0,1]], colors=['#ff8585','#8dddab','#85b9ff'];
    function basis(){return {right:[Math.cos(yaw),-Math.sin(yaw),0],up:[-Math.sin(yaw)*Math.sin(pitch),-Math.cos(yaw)*Math.sin(pitch),Math.cos(pitch)],depth:[Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)]};}
    function project(p){const b=basis(),d=sub(p,focus),s=Math.min(w/4.5,h/3.6)*zoom;return [w/2+dot(d,b.right)*s,h*.54-dot(d,b.up)*s,dot(d,b.depth)];}
    function line(a,b,color,width=1,dash=[]){const p=project(a),q=project(b);ctx.beginPath();ctx.setLineDash(dash);ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();ctx.setLineDash([]);}
    function label(p,text,color){const q=project(p);ctx.fillStyle=color;ctx.font='12px system-ui';ctx.fillText(text,q[0]+7,q[1]-7);}
    function arrow(a,b,color,width=2){line(a,b,color,width);const p=project(a),q=project(b),t=Math.atan2(q[1]-p[1],q[0]-p[0]);ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]-10*Math.cos(t-.4),q[1]-10*Math.sin(t-.4));ctx.lineTo(q[0]-10*Math.cos(t+.4),q[1]-10*Math.sin(t+.4));ctx.closePath();ctx.fillStyle=color;ctx.fill();}
    const mesh=[];
    const spherical=(r,t,p)=>[r*Math.sin(t)*Math.cos(p),r*Math.cos(t),1.7+r*Math.sin(t)*Math.sin(p)];
    // Clip boundary faces against the exact height constraints.
    function clip(poly,z,above){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ia=above?a[2]>=z:a[2]<=z,ib=above?b[2]>=z:b[2]<=z;if(ia)out.push(a);if(ia!==ib)out.push(add(a,mul(sub(b,a),(z-a[2])/(b[2]-a[2]))));}return out;}
    function face(poly){poly=clip(clip(poly,.3,true),2.5,false);if(poly.length>=3)mesh.push(poly);}
    for(const r of [1.6,2.3])for(let j=0;j<12;j++)for(let k=0;k<48;k++){const t=j*Math.PI/72,u=(j+1)*Math.PI/72,p=k*Math.PI/24,q=(k+1)*Math.PI/24;face([spherical(r,t,p),spherical(r,u,p),spherical(r,u,q),spherical(r,t,q)]);}
    for(let j=0;j<7;j++)for(let k=0;k<48;k++){const r=1.6+j*.1,s=r+.1,p=k*Math.PI/24,q=(k+1)*Math.PI/24;face([spherical(r,Math.PI/6,p),spherical(s,Math.PI/6,p),spherical(s,Math.PI/6,q),spherical(r,Math.PI/6,q)]);}
    // Fill the upper cut through the shell (the lower plane does not intersect this cone).
    const dz=2.5-base[2], minY=dz/Math.tan(Math.PI/6),maxY=Math.sqrt(2.3**2-dz**2);
    for(let j=0;j<48;j++){const y=minY+(maxY-minY)*j/48,v=minY+(maxY-minY)*(j+1)/48;
      const half=y=>Math.sqrt(Math.max(0,Math.min((y*Math.tan(Math.PI/6))**2-dz**2,2.3**2-dz**2-y*y)));
      face([[-half(y),y,2.5],[half(y),y,2.5],[half(v),v,2.5],[-half(v),v,2.5]]);}
    function draw(){ctx.clearRect(0,0,w,h);for(let x=-1.5;x<=1.5;x+=.5)line([x,0,0],[x,3,0],'#273541');for(let y=0;y<=3;y+=.5)line([-1.5,y,0],[1.5,y,0],'#273541');
      line([0,0,0],base,'#7f90a1',5);label(base,'Robot base','#9caebd');arrow(base,add(base,[0,.65,0]),'#9caebd');label(add(base,[0,.65,0]),'+Y','#9caebd');
      mesh.map(poly=>({q:poly.map(project)})).sort((a,b)=>a.q.reduce((s,p)=>s+p[2],0)/a.q.length-b.q.reduce((s,p)=>s+p[2],0)/b.q.length).forEach(({q})=>{ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle='rgba(64,210,209,.045)';ctx.fill();ctx.strokeStyle='rgba(78,215,215,.15)';ctx.lineWidth=.6;ctx.stroke();});
      line(point,[point[0],point[1],0],'#f4b26c',1,[4,4]);line(base,point,'#829bad',1,[3,5]);
      axes.forEach((a,i)=>{const end=add(point,mul(a,.48));arrow(point,end,colors[i],3);label(end,['X','Y','Z'][i],colors[i]);});
      arrow(point,add(point,mul(direction(point,angle),.65)),'#ffd27e',3);
      const p=project(point);ctx.beginPath();ctx.arc(p[0],p[1],9,0,Math.PI*2);ctx.fillStyle=contains(point)?'#ffab65':'#ff626e';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
      ctx.fillStyle='#9cabbc';ctx.font='11px system-ui';ctx.fillText('WORLD FRAME · METRES',16,h-16);
    }
    function resize(){const r=canvas.getBoundingClientRect();w=r.width;h=r.height;const d=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);ctx.setTransform(d,0,0,d,0,0);draw();}
    const distance=(p,a,b)=>{const v=[b[0]-a[0],b[1]-a[1]],t=Math.max(0,Math.min(1,((p[0]-a[0])*v[0]+(p[1]-a[1])*v[1])/(v[0]**2+v[1]**2||1)));return Math.hypot(p[0]-a[0]-t*v[0],p[1]-a[1]-t*v[1]);};
    canvas.addEventListener('pointerdown',e=>{if(!enabled)return;const r=canvas.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top],o=project(point);let mode='orbit';if(Math.hypot(p[0]-o[0],p[1]-o[1])<18)mode='point';else {let best=14;axes.forEach((a,i)=>{const d=distance(p,o,project(add(point,mul(a,.48))));if(d<best){best=d;mode=i;}});}drag={x:e.clientX,y:e.clientY,point:[...point],yaw,pitch,mode};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
    canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y,s=Math.min(w/4.5,h/3.6)*zoom,b=basis();if(drag.mode==='orbit'){yaw=drag.yaw-dx*.008;pitch=Math.max(-.6,Math.min(1.3,drag.pitch+dy*.008));draw();return;}let next;if(drag.mode==='point')next=add(drag.point,add(mul(b.right,dx/s),mul(b.up,-dy/s)));else {const a=axes[drag.mode],sx=dot(a,b.right)*s,sy=-dot(a,b.up)*s;next=add(drag.point,mul(a,(dx*sx+dy*sy)/Math.max(1,sx*sx+sy*sy)));}onMove(next.map((v,i)=>Math.max([-1.3,.8,.3][i],Math.min([1.3,2.5,2.5][i],v))));});
    const end=()=>{drag=null;canvas.style.cursor='grab';};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
    canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.65,Math.min(1.65,zoom*Math.exp(-e.deltaY*.001)));draw();},{passive:false});
    new ResizeObserver(resize).observe(canvas);
    return {set(p,t){point=p;angle=t;draw();},enable(v){enabled=v;},reset(){yaw=.72;pitch=.35;zoom=.82;draw();}};
  }
  return {contains,direction,create};
})();

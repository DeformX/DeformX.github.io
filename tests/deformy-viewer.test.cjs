// Dependency-free regression checks: node --test tests/deformy-viewer.test.cjs
// Run the production controller with a small DOM/player and inference-service stub.
// These checks cover controller behavior; they do not replace visual browser QA.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'DeformY');
const source = fs.readFileSync(path.join(root, 'viewer.js'), 'utf8');
const json = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const workspace = json('assets/viewer/workspace.json');
const swings = json('assets/viewer/swings.json');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup(options={}) {
  const elements = new Map(), requests = [], storage = new Map();
  storage.set('pisi.guides', '0'); // Every legacy visit persisted off, even without an explicit choice.
  if (options.savedGuides !== undefined) storage.set('pisi.guides.v2', options.savedGuides);
  class Element {
    constructor(id='') {this.id=id;this.value='';this.textContent='';this.children=[];this.listeners={};this.attributes={};this.disabled=false;this.hidden=false;const classes=new Set();this.classList={add:s=>classes.add(s),toggle:(s,on)=>on?classes.add(s):classes.delete(s),contains:s=>classes.has(s)};}
    get valueAsNumber() {return this.value.trim()===''?NaN:Number(this.value);}
    set innerHTML(html) {this.html=html;for(const match of html.matchAll(/id="([^"]+)"/g)) if(!elements.has(match[1]))elements.set(match[1],new Element(match[1]));}
    get innerHTML() {return this.html||'';}
    setAttribute(k,v) {this.attributes[k]=v;}
    appendChild(el) {this.children.push(el);return el;}
    addEventListener(k,cb) {this.listeners[k]=cb;}
    querySelector(selector) {return selector==='#swing-note'?elements.get('swing-note'):null;}
  }
  ['swings','swing-view','swing-picker','swing-note','row'].forEach(id=>elements.set(id,new Element(id)));
  elements.get('swing-view').parentElement=new Element();
  const document={getElementById:id=>elements.get(id),querySelector:()=>elements.get('row'),createElement:()=>new Element(),activeElement:null};
  let arm, player;
  const sub=(a,b)=>a.map((v,i)=>v-b[i]), add=(a,b)=>a.map((v,i)=>v+b[i]), scl=(a,s)=>a.map(v=>v*s);
  const DY={setArm:a=>arm=a,arm:()=>arm,sub,add,scl,nrm:a=>scl(a,1/(Math.hypot(...a)||1)),dot3:(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],player:(id,opts)=>player={...opts,cur:0,hooks:[],draw(){},setPlaying(){},setSample(i){this.cur=i;this.onsample?.(i);}}};
  const response=data=>({ok:true,json:async()=>data});
  const fetch=async(url,opts)=>{
    requests.push({url,opts});
    if(url.endsWith('/api/health')) return response(await (options.health?.promise??{ready:options.online!==false}));
    if(url.endsWith('/api/infer')) {if(options.inference)return response(await options.inference.promise);return response({id:'test-job'});}
    if(url.endsWith('/api/job/test-job')) return response({state:'done',result:{metrics:{hit:true,miss_cm:1,psi_deg:1,s_d:2,M:0,exported:true},goal:{dstar:[0,0,1],zh:[0,-1,0]},q:[[],[]],rope:[[],[]]}});
    if(url==='assets/viewer/workspace.json') {if(options.missingWorkspace)throw Error('missing workspace');return response(Object.hasOwn(options,'workspace')?options.workspace:workspace);}
    return response(json(url));
  };
  await vm.runInNewContext(source,{document,window:{innerWidth:1280},DY,fetch,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},setTimeout});
  await flush();
  assert.ok(elements.has('sl-run'), 'controller initialized');
  const get=id=>elements.get(id);
  return {get,player,requests,storage,document,guides:get('row').children[0],posts:()=>requests.filter(r=>r.url.endsWith('/api/infer')),
    drag:p=>player.onhandle('goal',p,'move'),
    edit(k,value){const el=get('sl-'+k);el.value=String(value);el.listeners.input();},
    click:()=>get('sl-run').onclick()};
}

test('Guides default on, expose pressed state, and respect an explicit saved off choice', async()=>{
  const h=await setup();assert.equal(h.player.groups.workspace,true);assert.equal(h.player.layers.axes,true);assert.equal(h.guides.attributes['aria-pressed'],'true');assert.equal(h.storage.get('pisi.guides.v2'),'1');
  h.guides.onclick();assert.equal(h.player.groups.workspace,false);assert.equal(h.guides.attributes['aria-pressed'],'false');
  const off=await setup({savedGuides:'0'});assert.equal(off.player.groups.workspace,false);
});

test('Shell, full 3D cone and height bounds match exact workspace metadata', async()=>{
  const h=await setup();
  const inside=[[0,2,1.5],[0,2.1,2.5],[0,1.6,1.7],[0,2.3,1.7],[1,Math.sqrt(3),1.7],[1.15,2.3*Math.cos(Math.PI/6),1.7],[0,2.3*Math.cos(Math.PI/6),.55],...swings.map(s=>s.sample.goals[0].p)];
  for(const p of inside){h.drag(p);assert.equal(h.get('sl-run').disabled,false,`inside: ${p}`);}
  const outside=[[0,1.59,1.7],[0,2.31,1.7],[1,1.7,1.7],[0,1.8,.5],[0,2,2.5002],[0,2.2,2.5],[0,-2,1.7],[0,0,1.7],[NaN,2,1.7],[Infinity,2,1.7]];
  for(const p of outside){h.drag(p);assert.equal(h.get('sl-run').disabled,true,`outside: ${p}`);h.click();}
  assert.equal(h.posts().length,0);
});

test('Input, dragging and Guides toggle immediately update blocking guidance', async()=>{
  const h=await setup();h.edit('y',5);assert.equal(h.get('sl-run').disabled,true);assert.match(h.get('sl-validation').textContent,/outside the reachable region.*inside the yellow boundary/);
  h.guides.onclick();assert.match(h.get('sl-validation').textContent,/Turn on Guides/);
  h.guides.onclick();assert.doesNotMatch(h.get('sl-validation').textContent,/Turn on Guides/);
  h.drag([0,2,1.5]);assert.equal(h.get('sl-run').disabled,false);assert.equal(h.get('sl-validation').hidden,true);
  for(const k of ['x','y','z','angle']){const old=h.get('sl-'+k).value;h.edit(k,'');h.click();assert.equal(h.get('sl-run').disabled,true);assert.match(h.get('sl-validation').textContent,/finite number/);h.edit(k,old);assert.equal(h.get('sl-run').disabled,false);}
  h.edit('angle','1e');assert.equal(h.get('sl-run').disabled,true);assert.equal(h.posts().length,0);
});

test('No request before health readiness or for an invalid target when health resolves', async()=>{
  const health=deferred();const h=await setup({health});assert.equal(h.get('sl-run').disabled,true);h.click();h.drag([0,3,1.5]);health.resolve({ready:true});await flush();assert.equal(h.get('sl-run').disabled,true);h.click();assert.equal(h.posts().length,0);h.drag([0,2,1.5]);assert.equal(h.get('sl-run').disabled,false);
  const offline=await setup({online:false});offline.click();assert.equal(offline.posts().length,0);assert.equal(offline.get('sl-run').disabled,true);
});

test('Run handler rechecks invalid fields even if an input event has not fired', async()=>{
  const h=await setup();h.get('sl-x').value='';h.click();assert.equal(h.posts().length,0);assert.equal(h.get('sl-run').disabled,true);
});

test('Valid runs keep the configured endpoint and prevent duplicate submissions', async()=>{
  const inference=deferred();const h=await setup({inference});h.drag([0,2,1.5]);h.click();h.click();assert.equal(h.posts().length,1);assert.equal(h.posts()[0].url,json('demo-config.json').inference+'/api/infer');assert.deepEqual(JSON.parse(h.posts()[0].opts.body).goal.p,[0,2,1.5]);
  inference.resolve({id:'test-job'});await flush();assert.equal(h.get('sl-run').disabled,false);assert.equal(h.get('sl-run').textContent,'Run');assert.equal(h.player.samples.length,swings.length+1);assert.equal(h.get('swing-picker').children.at(-1).textContent,'Run 1');
});

test('Failed run completion cannot re-enable an out-of-region target; recovery permits retry', async()=>{
  const inference=deferred();const h=await setup({inference});h.click();h.drag([0,3,1.5]);inference.reject(Error('test failure'));await flush();assert.equal(h.get('sl-run').disabled,true);assert.match(h.get('sl-msg').textContent,/Run failed/);h.click();assert.equal(h.posts().length,1);h.drag([0,2,1.5]);assert.equal(h.get('sl-run').disabled,false);
});

test('Missing and malformed workspace metadata fail closed without removing Browse', async()=>{
  const invalid=[null,{}, {...workspace,workspace:{...workspace.workspace,axis:[0,0,0]}},{...workspace,workspace:{...workspace.workspace,radius:[2.3,1.6]}},{...workspace,workspace:{...workspace.workspace,bearing_half_deg:NaN}},{...workspace,workspace:{...workspace.workspace,axis:[1.7e308,1.7e308,1.7e308]}}];
  for(const options of [{missingWorkspace:true},...invalid.map(workspace=>({workspace}))]){const h=await setup(options);h.click();assert.equal(h.get('sl-run').disabled,true);assert.match(h.get('sl-validation').textContent,/Reachable region unavailable/);assert.equal(h.get('swing-picker').children.length,swings.length);assert.equal(h.posts().length,0);}
});

test('Metadata axis normalization, minimum projection and limits are not hard-coded', async()=>{
  const h=await setup({workspace:{...workspace,workspace:{...workspace.workspace,axis:[0,2,0],min_axis_proj:1.9}}});
  h.drag([0,1.8,1.7]);assert.equal(h.get('sl-run').disabled,true);h.drag([0,2,1.7]);assert.equal(h.get('sl-run').disabled,false);
});

test('Page explains yellow reachable boundary and loads current validation controller', ()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(html,/The yellow boundary marks the reachable region\. Keep the pink target inside it/);assert.match(html,/viewer\.js\?v=reachable-region-1/);
});


test('Completed run selects its result without leaving a focused edited field out of sync', async()=>{
  const inference=deferred();const h=await setup({inference});h.drag([0,2,1.5]);h.click();
  h.document.activeElement=h.get('sl-x');h.edit('x',5);assert.equal(h.get('sl-run').disabled,true);
  inference.resolve({id:'test-job'});await flush();
  assert.equal(h.get('sl-x').value,'0.000');assert.equal(h.player.handles[0].p[0],0);
  assert.equal(h.get('sl-run').disabled,false);assert.equal(h.get('sl-validation').hidden,true);
});

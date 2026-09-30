const modes={position:{base:[68,83,65],ours:[89,95,77],mean:[72,87],criterion:'Success within 5 cm of the target.'},direction:{base:[41,55,53],ours:[75,83,79],mean:[50,79],criterion:'Success within 10 cm and 10° of the commanded arrival direction.'}};
const ropes=['Green braided rope','Black plastic chain','Yellow braided cord'];
function render(mode){const d=modes[mode];document.getElementById('criterion').textContent=d.criterion;document.getElementById('chart').innerHTML=ropes.map((name,i)=>`<div class="bar-row"><div class="rope-name">Rope ${'ABC'[i]}<small>${name}</small></div><div class="bars"><div class="track" aria-label="Base ${d.base[i]} percent"><div class="bar" style="width:${d.base[i]}%"></div><b>${d.base[i]}%</b></div><div class="track ours" aria-label="RECAP ${d.ours[i]} percent"><div class="bar" style="width:${d.ours[i]}%"></div><b>${d.ours[i]}%</b></div></div></div>`).join('');document.getElementById('total').innerHTML=`${d.mean[0]}% <span>→</span> ${d.mean[1]}%`;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});}document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>render(b.dataset.mode)));render('position');
// Open production instructions when a media-slot link is followed.
function revealMediaSlot(){const id=location.hash.slice(1);if(!id.startsWith('asset-'))return;const target=document.getElementById(id);if(!target)return;const details=target.closest('details');if(details)details.open=true;requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));}
window.addEventListener('hashchange',revealMediaSlot);revealMediaSlot();

// Defer video requests until page load and only load videos near the viewport.
window.addEventListener('load', () => {
  const videos = [...document.querySelectorAll('video:has(source[data-src])')];
  const loadVideo = video => {
    const source = video.querySelector('source[data-src]');
    if (source) { source.src = source.dataset.src; delete source.dataset.src; video.load(); }
  };
  const loader = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      loadVideo(entry.target); loader.unobserve(entry.target);
    }
  }, {rootMargin: '200px 0px'});
  const player = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting && !document.hidden) {
        loadVideo(video);
        video.play().catch(() => {});
      } else video.pause();
    }
  }, {threshold: 0.15});
  for (const video of videos) { loader.observe(video); player.observe(video); }
  document.addEventListener('visibilitychange', () => {
    for (const video of videos) {
      if (document.hidden) video.pause();
      else { const r = video.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight) { loadVideo(video); video.play().catch(() => {}); }
      }
    }
  });
});
// Transparent navigation over the fullscreen opening, solid after scrolling.
const siteHeader = document.querySelector('body > header');
const updateHeader = () => siteHeader.classList.toggle('scrolled', scrollY > 60);
window.addEventListener('scroll', updateHeader, {passive:true});
updateHeader();
const openingVideo = document.getElementById('opening-film');
const openingPause = document.querySelector('.opening-pause');
if (openingVideo && openingPause) {
  const updatePause = () => {
    openingPause.textContent = openingVideo.paused ? '▶' : 'Ⅱ';
    openingPause.setAttribute('aria-label', openingVideo.paused ? 'Play opening video' : 'Pause opening video');
  };
  openingPause.addEventListener('click', () => {
    if (openingVideo.paused) openingVideo.play().catch(() => {});
    else openingVideo.pause();
  });
  openingVideo.addEventListener('play', updatePause);
  openingVideo.addEventListener('pause', updatePause);
  updatePause();
}
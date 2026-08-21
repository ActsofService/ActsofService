(function(){
  const INACTIVITY_MS = 50000; // 1 minute (ms)
  const FADE_OUT_MS = 4000; // match CSS screensaverFadeOut duration (ms)
  const CIRCLE_SIZE = 65; // px (doubled)
  const SPAWN_INTERVAL_MS = 4000; // spawn every 5 seconds (lower frequency)
  const MAX_CIRCLES = 100; // maximum number of dots
  const REMOVE_INTERVAL_MS = 20; // rapid removal interval (ms)
  // Default palette of up to 10 colors — edit these to choose your 10 colors
  const COLOR_PALETTE = [
    '#ff4d4d',
    '#ff993a',
    '#641a15',
    '#8d5e29',
    '#109524',
    '#154aea',
    '#7751be',
    '#f872be',
    '#c5e364',
    '#3de3f2'
  ];

  let timer = null;
  let screensaverEl = null; 
  let circlesContainer = null;
  let circleInterval = null;
  let active = false;
  let fadingOut = false;

  function createScreensaver(){
    const el = document.createElement('div');
    el.className = 'screensaver';
    el.id = 'screensaver-overlay';
    return el;
  }

  function createCirclesContainer(){
    const c = document.createElement('div');
    c.className = 'screensaver-circles';
    c.id = 'screensaver-circles';
    return c;
  }

  function spawnCircle(){
    if (!circlesContainer) return;
    // enforce max
    if (circlesContainer.children.length >= MAX_CIRCLES) return;
    const circle = document.createElement('div');
    circle.className = 'screensaver-circle';

    // Pick a random color from the palette
    const color = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
    circle.style.background = color;

    // Random position within an area 10% larger than the viewport (centered)
    const EXTRA_PCT = 0.10; // 10% larger
    const padX = (window.innerWidth * EXTRA_PCT) / 2;
    const padY = (window.innerHeight * EXTRA_PCT) / 2;
    const spawnWidth = window.innerWidth + padX * 2;
    const spawnHeight = window.innerHeight + padY * 2;
    const x = (Math.random() * spawnWidth) - padX;
    const y = (Math.random() * spawnHeight) - padY;
    circle.style.left = `${x}px`;
    circle.style.top = `${y}px`;

    circlesContainer.appendChild(circle);

    // Note: circles are persistent by design (they do not get removed).
  }

  function startSpawning(){
    if (circleInterval) return;
    circleInterval = setInterval(spawnCircle, SPAWN_INTERVAL_MS);
  }

  function stopSpawning(){
    if (circleInterval) {
      clearInterval(circleInterval);
      circleInterval = null;
    }
  }

  function showScreensaver(){
    if (active) return;
    if(!screensaverEl) screensaverEl = createScreensaver();
    if(!circlesContainer) circlesContainer = createCirclesContainer();
    document.body.appendChild(screensaverEl);
    document.body.appendChild(circlesContainer);
    // Force reflow then start the long fade-in
    void screensaverEl.offsetWidth;
    screensaverEl.classList.add('showing');
    active = true;
    fadingOut = false;
    startSpawning();
  }

  function hideScreensaver(){
    if (!active || fadingOut) return;
    fadingOut = true;
    if (!screensaverEl && !circlesContainer) return;

    if (screensaverEl) {
      screensaverEl.classList.remove('showing');
      screensaverEl.classList.add('fading-out');
    }

    // stop creating new circles
    stopSpawning();

    // remove circles one-by-one in reverse order (LIFO) at a rapid rate
    if (circlesContainer) {
      const removalInterval = setInterval(() => {
        if (!circlesContainer) {
          clearInterval(removalInterval);
          return;
        }
        const last = circlesContainer.lastElementChild;
        if (last) {
          circlesContainer.removeChild(last);
        } else {
          clearInterval(removalInterval);
          if (circlesContainer && circlesContainer.parentNode) {
            circlesContainer.parentNode.removeChild(circlesContainer);
          }
          circlesContainer = null;
        }
      }, REMOVE_INTERVAL_MS);
    }
    // fade out then remove the screensaver element (background)
    setTimeout(() => {
      if (screensaverEl && screensaverEl.parentNode) {
        screensaverEl.parentNode.removeChild(screensaverEl);
      }
      if (circlesContainer && circlesContainer.parentNode) {
        circlesContainer.parentNode.removeChild(circlesContainer);
      }
      screensaverEl = null;
      active = false;
      fadingOut = false;
    }, FADE_OUT_MS + 50);
  }

  function resetTimer(){
    if(timer) clearTimeout(timer);
    timer = setTimeout(showScreensaver, INACTIVITY_MS);
  }

  function onActivity(){
    if(active) {
      hideScreensaver();
    }
    resetTimer();
  }

  const events = ['mousemove','mousedown','keydown','touchstart','wheel','pointerdown','pointermove'];
  events.forEach(ev => window.addEventListener(ev, onActivity, {passive:true}));

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    resetTimer();
  } else {
    window.addEventListener('DOMContentLoaded', resetTimer);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onActivity();
  });

})();

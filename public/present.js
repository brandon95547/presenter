// The broadcast screen follows the Presenter View over Server-Sent Events.
// A new slide is decoded off screen and faded in only once it is ready, so the
// stream never shows a blank or half-drawn frame. If the server goes away the
// last slide stays up, and the stream reconnects by itself.

const layers = [...document.querySelectorAll('.layer')];
let front = 0;
let shownUrl = null;
let wantedUrl = null;
const warm = new Map(); // url → Image, the slides either side of the current one

async function show(url) {
  wantedUrl = url;
  if (url === shownUrl) return;
  const back = layers[1 - front];
  if (!url) {
    layers.forEach((layer) => layer.classList.remove('is-shown'));
    shownUrl = null;
    return;
  }
  back.src = url;
  try {
    await back.decode();
  } catch {
    return; // Unreadable image: keep the current slide on air.
  }
  if (wantedUrl !== url) return; // A newer change arrived while this one decoded.
  back.classList.add('is-shown');
  layers[front].classList.remove('is-shown');
  front = 1 - front;
  shownUrl = url;
}

function preload(urls) {
  for (const url of urls) {
    if (!url || warm.has(url)) continue;
    const img = new Image();
    img.src = url;
    img.decode().catch(() => {});
    warm.set(url, img);
  }
  while (warm.size > 6) warm.delete(warm.keys().next().value);
}

const events = new EventSource('/api/events?view=present');
events.addEventListener('state', (event) => {
  const current = JSON.parse(event.data);
  show(current.slide?.url ?? null);
  preload([current.next, current.prev]);
});

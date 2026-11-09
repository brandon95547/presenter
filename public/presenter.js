// The Presenter View: picks the topic and slide on air, and manages the slides.
// The server holds what is on air; this page asks it to move and redraws from
// what it hears back, so the broadcast and this screen can never disagree.

const $ = (selector) => document.querySelector(selector);

const view = {
  topicList: $('[data-topic-list]'),
  newTopic: $('[data-new-topic]'),
  obsUrl: $('[data-obs-url]'),
  copyUrl: $('[data-copy-url]'),
  connection: $('[data-connection]'),
  title: $('[data-topic-title]'),
  current: $('[data-current]'),
  empty: $('[data-empty]'),
  prev: $('[data-prev]'),
  next: $('[data-next]'),
  counter: $('[data-counter]'),
  slides: $('[data-dropzone]'),
  grid: $('[data-grid]'),
  status: $('[data-status]'),
  importInput: $('[data-import]'),
};

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const ICON_REMOVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

let topics = [];
let current = { topic: null, index: 0, total: 0, slide: null };
let gridKey = '';

// ---- Talking to the server ---------------------------------------------------

async function request(method, url, body, headers = { 'Content-Type': 'application/json' }) {
  let res;
  try {
    res = await fetch(url, { method, headers, body: body instanceof Blob ? body : JSON.stringify(body) });
  } catch {
    throw new Error('The presenter server is not running. Start it again and this page will reconnect.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let statusTimer;
function say(message, { error = false, sticky = false } = {}) {
  clearTimeout(statusTimer);
  view.status.textContent = message;
  view.status.classList.toggle('is-error', error);
  if (!sticky) statusTimer = setTimeout(() => (view.status.textContent = ''), error ? 6000 : 2500);
}

function attempt(promise) {
  return promise.catch((error) => say(error.message, { error: true }));
}

const step = (delta) => attempt(request('POST', '/api/go', { step: delta }));
const goTo = (topic, file) => attempt(request('POST', '/api/go', { topic, file }));

// ---- Drawing -------------------------------------------------------------------

const currentTopic = () => topics.find((topic) => topic.id === current.topic);

function renderTopics() {
  view.topicList.replaceChildren(
    ...topics.map((topic) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'topic';
      button.setAttribute('aria-current', String(topic.id === current.topic));
      button.innerHTML = '<span></span><span class="topic-count"></span>';
      button.firstChild.textContent = topic.label;
      button.lastChild.textContent = topic.slides.length;
      button.addEventListener('click', () => topic.id !== current.topic && goTo(topic.id));
      return button;
    }),
  );
}

function renderLive() {
  const topic = currentTopic();
  view.title.textContent = topic?.label ?? 'No topics yet';
  if (current.slide) {
    if (view.current.getAttribute('src') !== current.slide.url) view.current.src = current.slide.url;
  } else {
    view.current.removeAttribute('src');
  }
  view.empty.hidden = Boolean(current.slide);
  view.counter.textContent = `${current.total ? current.index + 1 : 0} / ${current.total}`;
  view.prev.disabled = current.index <= 0;
  view.next.disabled = current.index >= current.total - 1;
}

function thumbFor(slide, index, topicId) {
  const item = document.createElement('li');
  item.className = 'thumb';
  item.draggable = true;
  item.dataset.file = slide.file;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'thumb-pick';
  pick.setAttribute('aria-label', `Show slide ${index + 1}, ${slide.file}`);
  pick.title = slide.file;
  const img = document.createElement('img');
  Object.assign(img, { alt: '', width: 1080, height: 1920, loading: 'lazy', decoding: 'async', src: slide.url });
  pick.append(img);
  pick.addEventListener('click', () => goTo(topicId, slide.file));

  const number = document.createElement('span');
  number.className = 'thumb-number';
  number.textContent = index + 1;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'thumb-remove';
  remove.setAttribute('aria-label', `Remove slide ${index + 1}`);
  remove.title = 'Remove slide';
  remove.innerHTML = ICON_REMOVE;
  remove.addEventListener('click', () => removeSlide(topicId, slide.file, index));

  item.append(pick, number, remove);
  return item;
}

function renderGrid() {
  const topic = currentTopic();
  const key = topic ? `${topic.id}|${topic.slides.map((slide) => slide.url).join('|')}` : '';
  if (key !== gridKey) {
    gridKey = key;
    view.grid.replaceChildren(...(topic?.slides ?? []).map((slide, i) => thumbFor(slide, i, topic.id)));
  }
  for (const item of view.grid.children) {
    item.setAttribute('aria-current', String(item.dataset.file === current.slide?.file));
  }
}

function render() {
  renderTopics();
  renderLive();
  renderGrid();
}

// ---- Live updates --------------------------------------------------------------

function connect() {
  const events = new EventSource('/api/events?view=presenter');
  events.addEventListener('open', () => {
    view.connection.textContent = 'Connected';
    view.connection.className = 'connection is-online';
  });
  events.addEventListener('error', () => {
    view.connection.textContent = 'Server stopped — reconnecting…';
    view.connection.className = 'connection is-offline';
  });
  events.addEventListener('library', (event) => {
    topics = JSON.parse(event.data);
  });
  events.addEventListener('state', (event) => {
    current = JSON.parse(event.data);
    render();
  });
}

// ---- Navigation ----------------------------------------------------------------

view.prev.addEventListener('click', () => step(-1));
view.next.addEventListener('click', () => step(1));

const KEYS = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
document.addEventListener('keydown', (event) => {
  const delta = KEYS[event.key];
  if (!delta || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest('input, textarea, select')) return;
  event.preventDefault();
  step(delta);
});

// ---- Topics ----------------------------------------------------------------------

view.newTopic.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = view.newTopic.elements.name;
  const name = input.value.trim();
  if (!name) return input.focus();
  try {
    const topic = await request('POST', '/api/topics', { name });
    input.value = '';
    say(`Added “${topic.label}”. Its folder is slides/${topic.id}.`);
  } catch (error) {
    say(error.message, { error: true });
  }
});

// ---- Import ----------------------------------------------------------------------

async function importFiles(fileList) {
  const topic = currentTopic();
  if (!topic) return say('Add a topic first, then import its images.', { error: true });
  const files = [...fileList];
  const images = files.filter((file) => ACCEPTED.includes(file.type));
  const skipped = files.length - images.length;
  let done = 0;
  for (const file of images) {
    say(`Importing ${done + 1} of ${images.length}…`, { sticky: true });
    try {
      await request('POST', `/api/topics/${topic.id}/slides?name=${encodeURIComponent(file.name)}`, file, {
        'Content-Type': file.type,
      });
      done += 1;
    } catch (error) {
      say(error.message, { error: true });
      return;
    }
  }
  const note = skipped ? ` Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? "isn't" : "aren't"} PNG, JPG or WebP.` : '';
  say(`Imported ${done} slide${done === 1 ? '' : 's'}.${note}`, { error: Boolean(skipped) });
}

view.importInput.addEventListener('change', () => {
  importFiles(view.importInput.files);
  view.importInput.value = '';
});

const carriesFiles = (event) => event.dataTransfer?.types.includes('Files');

view.slides.addEventListener('dragover', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  view.slides.classList.add('is-receiving');
});
view.slides.addEventListener('dragleave', (event) => {
  if (!view.slides.contains(event.relatedTarget)) view.slides.classList.remove('is-receiving');
});
view.slides.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  view.slides.classList.remove('is-receiving');
  importFiles(event.dataTransfer.files);
});

// ---- Reorder -----------------------------------------------------------------------

let dragged = null;

function clearMarks() {
  for (const item of view.grid.children) item.classList.remove('is-drop-before', 'is-drop-after');
}

function dropSide(item, event) {
  const box = item.getBoundingClientRect();
  return event.clientX < box.left + box.width / 2 ? 'before' : 'after';
}

view.grid.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.thumb');
  if (!item) return;
  dragged = item.dataset.file;
  item.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragged);
});

view.grid.addEventListener('dragend', () => {
  dragged = null;
  clearMarks();
  for (const item of view.grid.children) item.classList.remove('is-dragging');
});

view.grid.addEventListener('dragover', (event) => {
  const item = event.target.closest('.thumb');
  if (!dragged || !item) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearMarks();
  if (item.dataset.file !== dragged) item.classList.add(`is-drop-${dropSide(item, event)}`);
});

view.grid.addEventListener('drop', async (event) => {
  const item = event.target.closest('.thumb');
  const topic = currentTopic();
  if (!dragged || !item || !topic) return;
  event.preventDefault();
  const moving = dragged;
  clearMarks();
  if (item.dataset.file === moving) return;
  const order = topic.slides.map((slide) => slide.file).filter((file) => file !== moving);
  const at = order.indexOf(item.dataset.file) + (dropSide(item, event) === 'after' ? 1 : 0);
  order.splice(at, 0, moving);
  try {
    await request('PUT', `/api/topics/${topic.id}/order`, { files: order });
  } catch (error) {
    say(error.message, { error: true });
  }
});

// ---- Remove --------------------------------------------------------------------------

async function removeSlide(topicId, file, index) {
  const ok = window.confirm(
    `Remove slide ${index + 1} (${file})?\n\nThe image moves to the “removed” folder, so it can be put back from Finder.`,
  );
  if (!ok) return;
  try {
    await request('DELETE', `/api/topics/${topicId}/slides/${encodeURIComponent(file)}`);
    say('Slide removed.');
  } catch (error) {
    say(error.message, { error: true });
  }
}

// ---- OBS -------------------------------------------------------------------------------

const obsUrl = `${location.origin}/present`;
view.obsUrl.textContent = obsUrl;
view.copyUrl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(obsUrl);
    view.copyUrl.textContent = 'Copied';
  } catch {
    view.copyUrl.textContent = 'Select and copy above';
  }
  setTimeout(() => (view.copyUrl.textContent = 'Copy URL'), 2000);
});

connect();

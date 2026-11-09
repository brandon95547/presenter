// What is on air: the topic and slide being shown. The Presenter View moves it,
// every open view hears each change over Server-Sent Events, and it is saved so a
// restart picks up where the show left off.

import fs from 'node:fs/promises';

export function createLive({ library, stateFile }) {
  let state = { topic: null, file: null, index: 0 };
  const clients = new Set();
  // Moves run one at a time, so two quick presses of Next move two slides.
  let queue = Promise.resolve();
  const serial = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  async function load() {
    try {
      const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      state = { topic: saved.topic ?? null, file: saved.file ?? null, index: Number(saved.index) || 0 };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Starting from the first slide; the saved position was unreadable:', error.message);
    }
  }

  async function save() {
    try {
      await fs.writeFile(stateFile, `${JSON.stringify(state)}\n`);
    } catch (error) {
      console.warn('Could not save the current slide:', error.message);
    }
  }

  /** The current slide worked out against the folder as it is now. */
  function resolve(topics) {
    const topic = topics.find((t) => t.id === state.topic) ?? topics.find((t) => t.slides.length) ?? topics[0];
    if (!topic) return { topic: null, index: 0, total: 0, slide: null, prev: null, next: null };
    const { slides } = topic;
    let index = slides.findIndex((slide) => slide.file === state.file);
    // The slide on air was removed or renamed: stay at the same place in the list.
    if (index < 0) index = Math.max(0, Math.min(state.index, slides.length - 1));
    return {
      topic: topic.id,
      index,
      total: slides.length,
      slide: slides[index] ?? null,
      prev: slides[index - 1]?.url ?? null,
      next: slides[index + 1]?.url ?? null,
    };
  }

  function send(client, event, data) {
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  async function snapshot() {
    const topics = await library.list();
    return { topics, current: resolve(topics) };
  }

  /** Tells every open view about the current slide and the library. */
  async function broadcast() {
    const { topics, current } = await snapshot();
    for (const client of clients) {
      if (client.wantsLibrary) send(client, 'library', topics);
      send(client, 'state', current);
    }
    return current;
  }

  async function settle(topics, next) {
    state = next;
    const current = resolve(topics);
    state = { topic: current.topic, file: current.slide?.file ?? null, index: current.index };
    await save();
    await broadcast();
    return current;
  }

  return {
    load,
    snapshot,
    broadcast,

    /** Shows a topic, at a given slide or its first one. */
    go: (topicId, file) => serial(async () => {
      const topics = await library.list();
      const topic = topics.find((t) => t.id === topicId);
      if (!topic) return resolve(topics);
      const index = Math.max(0, topic.slides.findIndex((slide) => slide.file === file));
      return settle(topics, { topic: topic.id, file: topic.slides[index]?.file ?? null, index });
    }),

    /** Moves forward (+1) or back (-1), stopping at either end of the topic. */
    step: (delta) => serial(async () => {
      const topics = await library.list();
      const current = resolve(topics);
      const topic = topics.find((t) => t.id === current.topic);
      if (!topic?.slides.length) return current;
      const index = Math.max(0, Math.min(topic.slides.length - 1, current.index + Math.sign(delta)));
      return settle(topics, { topic: topic.id, file: topic.slides[index].file, index });
    }),

    /** Opens an event stream for one view. The Presenter View also gets the library. */
    async connect(res, { wantsLibrary }) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n');
      const client = res;
      client.wantsLibrary = wantsLibrary;
      clients.add(client);
      const heartbeat = setInterval(() => res.write(': still here\n\n'), 15000);
      res.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(client);
      });
      const { topics, current } = await snapshot();
      if (wantsLibrary) send(client, 'library', topics);
      send(client, 'state', current);
    },
  };
}

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLibrary, imageExtensionOf, topicIdFrom, topicLabel } from '../lib/library.js';
import { createLive } from '../lib/live.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

let dir;
let library;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-'));
  await fs.mkdir(path.join(dir, 'slides'));
  library = createLibrary({ slidesDir: path.join(dir, 'slides'), removedDir: path.join(dir, 'removed') });
});

test('topic names become folder names and back', () => {
  assert.equal(topicIdFrom('  World Religions! '), 'world-religions');
  assert.equal(topicIdFrom('Café Talk'), 'cafe-talk');
  assert.equal(topicLabel('world-religions'), 'World Religions');
});

test('images are recognized by their bytes, not their names', () => {
  assert.equal(imageExtensionOf(PNG), '.png');
  assert.equal(imageExtensionOf(JPG), '.jpg');
  assert.equal(imageExtensionOf(WEBP), '.webp');
  assert.equal(imageExtensionOf(Buffer.from('GIF89a this is a gif')), null);
});

test('files dropped in through Finder are listed in name order', async () => {
  await fs.mkdir(path.join(dir, 'slides', 'religion'));
  for (const name of ['10-end.png', '2-middle.jpg', '1-start.webp', 'notes.txt', '.hidden.png']) {
    await fs.writeFile(path.join(dir, 'slides', 'religion', name), PNG);
  }
  const [topic] = await library.list();
  assert.equal(topic.label, 'Religion');
  assert.deepEqual(
    topic.slides.map((s) => s.file),
    ['1-start.webp', '2-middle.jpg', '10-end.png'],
  );
  assert.match(topic.slides[0].url, /^\/slides\/religion\/1-start\.webp\?v=\d+$/);
});

test('imports go to the end, and a reorder sticks', async () => {
  await library.createTopic('Religion');
  assert.equal(await library.addSlide('religion', 'Opening Slide.png', PNG), 'Opening-Slide.png');
  assert.equal(await library.addSlide('religion', 'Opening Slide.png', JPG), 'Opening-Slide.jpg');
  assert.equal(await library.addSlide('religion', 'Opening Slide.png', PNG), 'Opening-Slide-2.png');
  await fs.writeFile(path.join(dir, 'slides', 'religion', '0-from-finder.png'), PNG);

  let files = (await library.topic('religion')).slides.map((s) => s.file);
  assert.deepEqual(files, ['Opening-Slide.png', 'Opening-Slide.jpg', 'Opening-Slide-2.png', '0-from-finder.png']);

  await library.reorder('religion', [...files].reverse());
  files = (await library.topic('religion')).slides.map((s) => s.file);
  assert.deepEqual(files, ['0-from-finder.png', 'Opening-Slide-2.png', 'Opening-Slide.jpg', 'Opening-Slide.png']);
});

test('bad imports, reorders and topics are refused with a plain message', async () => {
  await library.createTopic('Religion');
  await assert.rejects(library.addSlide('religion', 'clip.gif', Buffer.from('GIF89a not allowed')), /isn't a PNG, JPG or WebP/);
  await assert.rejects(library.addSlide('../etc', 'x.png', PNG), /no longer exists/);
  await assert.rejects(library.createTopic('religion'), /already a topic/);
  await assert.rejects(library.createTopic('!!!'), /at least one letter/);
  await library.addSlide('religion', 'a.png', PNG);
  await assert.rejects(library.reorder('religion', ['a.png', 'a.png']), /changed/);
  assert.equal(await library.slidePath('religion', '../../server.js'), null);
});

test('a removed slide moves to the removed folder', async () => {
  await library.createTopic('Religion');
  await library.addSlide('religion', 'a.png', PNG);
  await library.addSlide('religion', 'b.png', PNG);
  await library.removeSlide('religion', 'a.png');
  assert.deepEqual((await library.topic('religion')).slides.map((s) => s.file), ['b.png']);
  const kept = await fs.readdir(path.join(dir, 'removed', 'religion'));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /-a\.png$/);
});

test('the slide on air moves within its topic, stops at the ends, and survives a restart', async () => {
  await library.createTopic('Religion');
  for (const name of ['a.png', 'b.png', 'c.png']) await library.addSlide('religion', name, PNG);
  const stateFile = path.join(dir, 'state.json');
  const live = createLive({ library, stateFile });
  await live.load();

  assert.equal((await live.step(-1)).index, 0);
  await Promise.all([live.step(1), live.step(1), live.step(1)]);
  const atEnd = (await live.snapshot()).current;
  assert.equal(atEnd.slide.file, 'c.png');
  assert.equal(atEnd.next, null);

  // The slide on air is removed: the show stays at the same place.
  await live.go('religion', 'b.png');
  await library.removeSlide('religion', 'b.png');
  assert.equal((await live.snapshot()).current.slide.file, 'c.png');

  const restarted = createLive({ library, stateFile });
  await restarted.load();
  assert.equal((await restarted.snapshot()).current.slide.file, 'c.png');
});

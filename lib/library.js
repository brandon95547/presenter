// The slide library is the slides/ folder itself: each subfolder is a topic and
// each PNG, JPG or WebP inside it is a slide. The order of a topic's slides is kept
// in its hidden .order.json; files not listed there (new ones dropped in through
// Finder) follow in name order, so "01-intro.png, 02-…" works without the app.

import fs from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const ORDER_FILE = '.order.json';
const TOPIC_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

/** A plain-language error the browser may show as is. */
export class LibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** "world-religions" → "World Religions". */
export function topicLabel(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** "World Religions!" → "world-religions". */
export function topicIdFrom(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** The image type from the file's first bytes, or null if it isn't PNG, JPG or WebP. */
export function imageExtensionOf(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function isImageFile(name) {
  return !name.startsWith('.') && Object.hasOwn(IMAGE_TYPES, path.extname(name).toLowerCase());
}

function safeBaseName(name) {
  const base = path
    .basename(String(name), path.extname(String(name)))
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return base || 'slide';
}

export function createLibrary({ slidesDir, removedDir }) {
  async function topicIds() {
    const entries = await fs.readdir(slidesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && TOPIC_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort(byName);
  }

  async function readOrder(topicDir) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(topicDir, ORDER_FILE), 'utf8'));
      return Array.isArray(saved) ? saved.filter((name) => typeof name === 'string') : [];
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Ignoring unreadable ${ORDER_FILE} in ${topicDir}:`, error.message);
      return [];
    }
  }

  async function writeOrder(topicDir, files) {
    const target = path.join(topicDir, ORDER_FILE);
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(files, null, 2)}\n`);
    await fs.rename(temp, target);
  }

  async function readTopic(id) {
    const dir = path.join(slidesDir, id);
    const names = (await fs.readdir(dir)).filter(isImageFile);
    const present = new Set(names);
    const saved = (await readOrder(dir)).filter((name) => present.has(name));
    const listed = new Set(saved);
    const ordered = [...saved, ...names.filter((name) => !listed.has(name)).sort(byName)];
    const slides = await Promise.all(
      ordered.map(async (file) => {
        const { mtimeMs } = await fs.stat(path.join(dir, file));
        return { file, url: `/slides/${id}/${encodeURIComponent(file)}?v=${Math.round(mtimeMs)}` };
      }),
    );
    return { id, label: topicLabel(id), slides };
  }

  async function existingTopic(id) {
    if (typeof id !== 'string' || !TOPIC_ID.test(id) || !(await topicIds()).includes(id)) {
      throw new LibraryError('That topic no longer exists.', 404);
    }
    return readTopic(id);
  }

  return {
    slidesDir,

    /** Every topic with its slides in order. */
    async list() {
      return Promise.all((await topicIds()).map(readTopic));
    },

    topic: existingTopic,

    /** The file on disk for a slide, or null if it isn't one of the topic's slides. */
    async slidePath(id, file) {
      if (!TOPIC_ID.test(id) || !isImageFile(file) || file !== path.basename(file)) return null;
      const full = path.join(slidesDir, id, file);
      try {
        return (await fs.stat(full)).isFile() ? full : null;
      } catch {
        return null;
      }
    },

    async createTopic(name) {
      const id = topicIdFrom(name);
      if (!id) throw new LibraryError('Give the topic a name with at least one letter or number.');
      try {
        await fs.mkdir(path.join(slidesDir, id));
      } catch (error) {
        if (error.code === 'EEXIST') throw new LibraryError(`There is already a topic called “${topicLabel(id)}”.`, 409);
        throw error;
      }
      return readTopic(id);
    },

    /** Saves an imported image at the end of the topic. Returns its file name. */
    async addSlide(id, originalName, buffer) {
      const topic = await existingTopic(id);
      const ext = imageExtensionOf(buffer);
      if (!ext) throw new LibraryError(`“${originalName}” isn't a PNG, JPG or WebP image.`, 415);
      const dir = path.join(slidesDir, id);
      const base = safeBaseName(originalName);
      for (let n = 1; ; n += 1) {
        const file = n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`;
        try {
          await fs.writeFile(path.join(dir, file), buffer, { flag: 'wx' });
          await writeOrder(dir, [...topic.slides.map((slide) => slide.file), file]);
          return file;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
    },

    /** Puts the slides in the given order, which must name each slide once. */
    async reorder(id, files) {
      const topic = await existingTopic(id);
      const current = topic.slides.map((slide) => slide.file);
      const valid =
        Array.isArray(files) &&
        files.length === current.length &&
        new Set(files).size === files.length &&
        files.every((file) => current.includes(file));
      if (!valid) throw new LibraryError('The slides changed while you were moving them. Try again.', 409);
      await writeOrder(path.join(slidesDir, id), files);
    },

    /** Moves a slide out of the show into removed/<topic>/, so it can be got back from Finder. */
    async removeSlide(id, file) {
      const topic = await existingTopic(id);
      if (!topic.slides.some((slide) => slide.file === file)) {
        throw new LibraryError('That slide was already removed.', 404);
      }
      const target = path.join(removedDir, id);
      await fs.mkdir(target, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(path.join(slidesDir, id, file), path.join(target, `${stamp}-${file}`));
      await writeOrder(
        path.join(slidesDir, id),
        topic.slides.map((slide) => slide.file).filter((name) => name !== file),
      );
    },
  };
}

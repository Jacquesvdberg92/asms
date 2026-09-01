import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';

/**
 * Streaming zip read and write.
 *
 * This replaced adm-zip, which held every file it was given in memory as a
 * Buffer and then built the whole archive as one more Buffer before writing a
 * byte. That is fine for the 5 MB SteamCMD download and fatal for the thing
 * this app exists to protect: a played-in ARK save folder is routinely several
 * gigabytes, well past both Node's heap ceiling and the ~4 GB Buffer limit. So
 * backups did not degrade on a big world, they killed the process - unattended,
 * on whatever schedule the cron said.
 *
 * Everything here streams one entry at a time, so peak memory is one file's
 * worth of pipe buffer regardless of how big the archive gets.
 */

export interface ZipEntry {
  /** Path inside the archive, always with forward slashes. */
  name: string;
  /** Absolute path on disk. */
  file: string;
}

/** Every file under `dir`, as archive entries rooted at `prefix`. */
export function walkFolder(dir: string, prefix: string): ZipEntry[] {
  const out: ZipEntry[] = [];
  const visit = (at: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(full, name);
      else if (entry.isFile()) out.push({ name: `${prefix}/${name}`, file: full });
    }
  };
  visit(dir, '');
  return out;
}

/** Total bytes of a set of entries, for a disk-space check before writing. */
export function totalBytes(entries: ZipEntry[]): number {
  let bytes = 0;
  for (const entry of entries) {
    try {
      bytes += fs.statSync(entry.file).size;
    } catch {
      /* vanished between the walk and now */
    }
  }
  return bytes;
}

/**
 * Write entries to `destFile`, one at a time.
 *
 * yazl reads each source through a stream, so the process never holds more than
 * the file currently being deflated.
 */
export async function writeZip(entries: ZipEntry[], destFile: string): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    // A file that disappears mid-backup (ARK rotating a log) must not abort the
    // whole run - the rest of the world is still worth keeping.
    if (!fs.existsSync(entry.file)) continue;
    zip.addFile(entry.file, entry.name);
  }
  zip.end();

  const out = fs.createWriteStream(destFile);
  try {
    await pipeline(zip.outputStream, out);
  } catch (err) {
    // Never leave a half-written archive behind pretending to be a backup.
    fs.rmSync(destFile, { force: true });
    throw err;
  }
}

export interface ExtractOptions {
  /**
   * Decide where an archive entry lands, or drop it. Returns a path relative to
   * `destDir`, or null to skip. Returning a path does not bypass the escape
   * check below.
   */
  rename?: (entryName: string) => string | null;
}

/**
 * Extract `zipFile` into `destDir`.
 *
 * Entry names are treated as hostile. A name like `SavedArks/../../../evil.dll`
 * used to satisfy a `startsWith('SavedArks/')` prefix test and then escape the
 * destination once it was joined.
 *
 * Two things stop that now. yauzl refuses an absolute or traversing entry name
 * at the reader, before we ever see it - that is what catches a malicious
 * archive. The resolve-and-compare below is the second line: it covers where
 * the path actually comes from, which is the caller's `rename`, and it still
 * holds if the reader is ever swapped for one that is less careful.
 */
export async function extractZip(zipFile: string, destDir: string, opts: ExtractOptions = {}): Promise<number> {
  const root = path.resolve(destDir);
  const zip = await open(zipFile);
  let written = 0;

  try {
    for await (const entry of readEntries(zip)) {
      const raw = entry.fileName.replace(/\\/g, '/');
      if (raw.endsWith('/')) continue; // directory record
      const wanted = opts.rename ? opts.rename(raw) : raw;
      if (wanted === null) continue;

      const target = path.resolve(root, wanted);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error(`This archive contains an entry that would write outside the destination: ${entry.fileName}`);
      }

      fs.mkdirSync(path.dirname(target), { recursive: true });
      const source = await openReadStream(zip, entry);
      await pipeline(source, fs.createWriteStream(target));
      written += 1;
    }
  } finally {
    zip.close();
  }
  return written;
}

/** Entry names in an archive, without extracting anything. */
export async function listZip(zipFile: string): Promise<string[]> {
  const zip = await open(zipFile);
  const names: string[] = [];
  try {
    for await (const entry of readEntries(zip)) names.push(entry.fileName.replace(/\\/g, '/'));
  } finally {
    zip.close();
  }
  return names;
}

// ------------------------------------------------------------ yauzl plumbing

function open(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error(`Could not read ${file}`));
      else resolve(zip);
    });
  });
}

/** Walk entries one at a time, which is what lazyEntries buys us. */
async function* readEntries(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  const queue: yauzl.Entry[] = [];
  let done = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;

  const nudge = () => {
    const fn = wake;
    wake = null;
    fn?.();
  };

  zip.on('entry', (entry: yauzl.Entry) => {
    queue.push(entry);
    nudge();
  });
  zip.on('end', () => {
    done = true;
    nudge();
  });
  zip.on('error', (err: Error) => {
    failure = err;
    done = true;
    nudge();
  });

  zip.readEntry();
  for (;;) {
    if (queue.length) {
      yield queue.shift() as yauzl.Entry;
      zip.readEntry();
      continue;
    }
    if (failure) throw failure;
    if (done) return;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

function openReadStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error(`Could not read ${entry.fileName}`));
      else resolve(stream);
    });
  });
}

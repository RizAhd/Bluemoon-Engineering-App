/**
 * A fake of the `expo-file-system` classes the app uses (File, Directory,
 * Paths), backed by real files in the active phone's temp folder
 * (`<phone>/document`, `<phone>/cache`, `<phone>/bundle`; see world.ts).
 *
 * Real files, not a Map, so that the sqlite shim's file mode and the app's
 * own File calls (e.g. quarantining a corrupt database) see the same bytes.
 *
 * Follows the documented behaviour of the real API where the app depends on it:
 *   - `File.create()` throws if the file exists (unless `overwrite`) or the parent is missing
 *   - `delete()` throws when there is nothing to delete
 *   - `copySync` / `moveSync` throw when the destination exists (unless `overwrite`),
 *     and `move` re-points the moved object at its new location
 *   - `size` is 0 for a missing file; `digest()` is lowercase hex
 *   - async variants (`bytes`, `text`, `copy`, `move`, `write`) do the work synchronously
 *
 * Not faked: streams, file handles, watchers, downloads, uploads, previews.
 * `File.pickFileAsync` returns what the test queued with `queueFilePick`, else "cancelled".
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { activeStorage, world } from './world';

type Part = string | File | Directory;
export interface RelocationOptions {
  overwrite?: boolean;
}
export interface FileCreateOptions {
  intermediates?: boolean;
  overwrite?: boolean;
}
export interface DirectoryCreateOptions {
  intermediates?: boolean;
  overwrite?: boolean;
  idempotent?: boolean;
}
export interface FileWriteOptions {
  encoding?: 'utf8' | 'base64';
  append?: boolean;
}
export type FileDigestAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
type PickResult<T> = { canceled: false; result: T } | { canceled: true; result: null };

export const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const;
export const FileMode = { ReadWrite: 'rw', ReadOnly: 'r', WriteOnly: 'w', Append: 'wa', Truncate: 'wt' } as const;

const NODE_ALGO: Record<FileDigestAlgorithm, string> = {
  MD5: 'md5',
  'SHA-1': 'sha1',
  'SHA-256': 'sha256',
  'SHA-384': 'sha384',
  'SHA-512': 'sha512',
};

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.html': 'text/html',
};

function fsError(code: string, message: string, p: string): Error {
  return Object.assign(new Error(`${code}: ${message}, '${p}'`), { code });
}

function toFsPath(parts: Part[]): string {
  let current: string | null = null;
  for (const part of parts) {
    const s = typeof part === 'string' ? part : part.uri;
    if (/^file:\/\//i.test(s)) current = fileURLToPath(s);
    else if (current === null) current = isAbsolute(s) ? s : resolve(s);
    else current = join(current, s);
  }
  if (current === null) throw new Error('A path is required');
  return resolve(current);
}

function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

function statOrNull(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function toBytes(content: string | Uint8Array | ArrayBuffer, encoding: 'utf8' | 'base64'): Uint8Array | string {
  if (typeof content === 'string') return encoding === 'base64' ? Buffer.from(content, 'base64') : content;
  if (isArrayBuffer(content)) return new Uint8Array(content);
  return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
}

export class File {
  private p: string;

  constructor(...parts: Part[]) {
    this.p = toFsPath(parts);
  }

  /** Fake-only: the path on the host disk. */
  get path(): string {
    return this.p;
  }
  get uri(): string {
    return pathToFileURL(this.p).href;
  }
  get name(): string {
    return basename(this.p);
  }
  get extension(): string {
    return extname(this.p);
  }
  get parentDirectory(): Directory {
    return new Directory(dirname(this.p));
  }
  get type(): string {
    return MIME[extname(this.p).toLowerCase()] ?? 'application/octet-stream';
  }
  get contentUri(): string {
    return this.uri;
  }
  get exists(): boolean {
    return !!statOrNull(this.p)?.isFile();
  }
  get size(): number {
    const s = statOrNull(this.p);
    return s?.isFile() ? s.size : 0;
  }
  get md5(): string | null {
    return this.exists ? createHash('md5').update(readFileSync(this.p)).digest('hex') : null;
  }
  get modificationTime(): number | null {
    return statOrNull(this.p)?.mtimeMs ?? null;
  }
  get lastModified(): number | null {
    return this.modificationTime;
  }
  get creationTime(): number | null {
    return statOrNull(this.p)?.birthtimeMs ?? null;
  }

  info(options?: { md5?: boolean }) {
    const s = statOrNull(this.p);
    if (!s?.isFile()) return { exists: false, uri: this.uri };
    return {
      exists: true,
      uri: this.uri,
      size: s.size,
      modificationTime: s.mtimeMs,
      creationTime: s.birthtimeMs,
      ...(options?.md5 ? { md5: this.md5 } : {}),
    };
  }

  create(options: FileCreateOptions = {}): void {
    const s = statOrNull(this.p);
    if (s && (s.isDirectory() || !options.overwrite)) {
      throw fsError('ERR_FILE_EXISTS', 'Destination already exists', this.p);
    }
    if (options.intermediates) mkdirSync(dirname(this.p), { recursive: true });
    // no 'wx' flag: the exists check above has already decided
    writeFileSync(this.p, new Uint8Array(0));
  }

  delete(): void {
    if (!this.exists) throw fsError('ENOENT', 'no such file or directory, delete', this.p);
    rmSync(this.p);
  }

  textSync(): string {
    return readFileSync(this.p, 'utf8');
  }
  async text(): Promise<string> {
    return this.textSync();
  }
  base64Sync(): string {
    return readFileSync(this.p).toString('base64');
  }
  async base64(): Promise<string> {
    return this.base64Sync();
  }
  bytesSync(): Uint8Array {
    return new Uint8Array(readFileSync(this.p));
  }
  async bytes(): Promise<Uint8Array> {
    return this.bytesSync();
  }

  writeSync(content: string | Uint8Array | ArrayBuffer, options: FileWriteOptions = {}): void {
    const data = toBytes(content, options.encoding ?? 'utf8');
    if (options.append) appendFileSync(this.p, data);
    else writeFileSync(this.p, data);
  }
  async write(content: string | Uint8Array | ArrayBuffer, options?: FileWriteOptions): Promise<void> {
    this.writeSync(content, options);
  }

  private target(dest: File | Directory): string {
    return dest instanceof Directory ? join(dest.path, this.name) : dest.path;
  }

  copySync(dest: File | Directory, options: RelocationOptions = {}): void {
    if (!this.exists) throw fsError('ENOENT', 'no such file or directory, copy', this.p);
    const to = this.target(dest);
    if (existsSync(to) && !options.overwrite) throw fsError('ERR_FILE_EXISTS', 'Destination already exists', to);
    copyFileSync(this.p, to);
  }
  async copy(dest: File | Directory, options?: RelocationOptions): Promise<void> {
    this.copySync(dest, options);
  }

  /** Moves the file and re-points this object at its new location, like the real API. */
  moveSync(dest: File | Directory, options: RelocationOptions = {}): void {
    if (!this.exists) throw fsError('ENOENT', 'no such file or directory, move', this.p);
    const to = this.target(dest);
    if (existsSync(to) && !options.overwrite) throw fsError('ERR_FILE_EXISTS', 'Destination already exists', to);
    renameSync(this.p, to);
    this.p = to;
  }
  async move(dest: File | Directory, options?: RelocationOptions): Promise<void> {
    this.moveSync(dest, options);
  }

  rename(newName: string): void {
    const to = join(dirname(this.p), newName);
    renameSync(this.p, to);
    this.p = to;
  }

  async digest(algorithm: FileDigestAlgorithm): Promise<string> {
    const algo = NODE_ALGO[algorithm];
    if (!algo) throw new Error(`Unsupported digest algorithm: ${String(algorithm)}`);
    return createHash(algo).update(readFileSync(this.p)).digest('hex');
  }

  /** The document picker. Returns what the test queued with queueFilePick(), else "cancelled". */
  static pickFileAsync(options: { multipleFiles: true; mimeTypes?: string | string[] }): Promise<PickResult<File[]>>;
  static pickFileAsync(options?: { multipleFiles?: false; mimeTypes?: string | string[] }): Promise<PickResult<File>>;
  static async pickFileAsync(options?: { multipleFiles?: boolean; mimeTypes?: string | string[] }): Promise<PickResult<File | File[]>> {
    const w = world();
    const next = w.nextFilePick;
    w.nextFilePick = null;
    if (!next || !next.uris.length) return { canceled: true, result: null };
    const files = next.uris.map((u) => new File(u));
    return { canceled: false, result: options?.multipleFiles ? files : files[0] };
  }

  static async downloadFileAsync(): Promise<File> {
    throw new Error('File.downloadFileAsync is not available in tests');
  }
}

export class Directory {
  private p: string;

  constructor(...parts: Part[]) {
    this.p = toFsPath(parts);
  }

  /** Fake-only: the path on the host disk. */
  get path(): string {
    return this.p;
  }
  get uri(): string {
    const href = pathToFileURL(this.p).href;
    return href.endsWith('/') ? href : `${href}/`;
  }
  get name(): string {
    return basename(this.p);
  }
  get parentDirectory(): Directory {
    return new Directory(dirname(this.p));
  }
  get exists(): boolean {
    return !!statOrNull(this.p)?.isDirectory();
  }
  get size(): number | null {
    if (!this.exists) return null;
    let total = 0;
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else total += statSync(full).size;
      }
    };
    walk(this.p);
    return total;
  }

  info() {
    const s = statOrNull(this.p);
    if (!s?.isDirectory()) return { exists: false, uri: this.uri };
    return {
      exists: true,
      uri: this.uri,
      size: this.size ?? 0,
      modificationTime: s.mtimeMs,
      creationTime: s.birthtimeMs,
      files: readdirSync(this.p).sort(),
    };
  }

  create(options: DirectoryCreateOptions = {}): void {
    const s = statOrNull(this.p);
    if (s?.isDirectory()) {
      if (options.overwrite) rmSync(this.p, { recursive: true, force: true });
      else if (options.idempotent) return;
      else throw fsError('ERR_DIRECTORY_EXISTS', 'Destination already exists', this.p);
    } else if (s) {
      throw fsError('ERR_FILE_EXISTS', 'A file with the same path already exists', this.p);
    }
    mkdirSync(this.p, { recursive: !!options.intermediates });
  }

  delete(): void {
    if (!this.exists) throw fsError('ENOENT', 'no such file or directory, delete', this.p);
    rmSync(this.p, { recursive: true, force: true });
  }

  list(): (File | Directory)[] {
    if (!this.exists) throw fsError('ENOENT', 'no such file or directory, scandir', this.p);
    return readdirSync(this.p, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((e) => (e.isDirectory() ? new Directory(this.p, e.name) : new File(this.p, e.name)));
  }

  listAsRecords(): { isDirectory: boolean; uri: string }[] {
    return this.list().map((e) => ({ isDirectory: e instanceof Directory, uri: e.uri }));
  }

  createFile(name: string, _mimeType: string | null = null): File {
    const f = new File(this.p, name);
    f.create();
    return f;
  }

  createDirectory(name: string): Directory {
    const d = new Directory(this.p, name);
    d.create();
    return d;
  }

  private target(dest: File | Directory): string {
    return dest instanceof Directory && dest.exists ? join(dest.path, this.name) : dest.path;
  }

  copySync(dest: File | Directory, options: RelocationOptions = {}): void {
    if (!this.exists) throw fsError('ENOENT', 'no such file or directory, copy', this.p);
    const to = this.target(dest);
    if (existsSync(to) && !options.overwrite) throw fsError('ERR_DIRECTORY_EXISTS', 'Destination already exists', to);
    cpSync(this.p, to, { recursive: true, force: !!options.overwrite });
  }
  async copy(dest: File | Directory, options?: RelocationOptions): Promise<void> {
    this.copySync(dest, options);
  }

  moveSync(dest: File | Directory, options: RelocationOptions = {}): void {
    if (!this.exists) throw fsError('ENOENT', 'no such file or directory, move', this.p);
    const to = this.target(dest);
    if (existsSync(to) && !options.overwrite) throw fsError('ERR_DIRECTORY_EXISTS', 'Destination already exists', to);
    if (options.overwrite) rmSync(to, { recursive: true, force: true });
    renameSync(this.p, to);
    this.p = to;
  }
  async move(dest: File | Directory, options?: RelocationOptions): Promise<void> {
    this.moveSync(dest, options);
  }

  rename(newName: string): void {
    const to = join(dirname(this.p), newName);
    renameSync(this.p, to);
    this.p = to;
  }

  /** Fake-only: what the next pickDirectoryAsync returns (a folder the test made), or null for "cancelled". */
  static nextPick: Directory | null = null;
  static async pickDirectoryAsync(): Promise<Directory> {
    const d = Directory.nextPick;
    Directory.nextPick = null;
    if (!d) throw new Error('cancelled');
    return d;
  }
}

function partString(p: Part): string {
  return typeof p === 'string' ? p : p.uri;
}

export class Paths {
  /** App-private cache folder of the active phone (the OS may clear it). */
  static get cache(): Directory {
    return new Directory(activeStorage().cachePath);
  }
  /** App-private permanent folder of the active phone. */
  static get document(): Directory {
    return new Directory(activeStorage().documentPath);
  }
  static get bundle(): Directory {
    return new Directory(activeStorage().bundlePath);
  }
  static get appleSharedContainers(): Record<string, Directory> {
    return {};
  }
  static get totalDiskSpace(): number {
    return 64 * 1024 ** 3;
  }
  static get availableDiskSpace(): number {
    return 32 * 1024 ** 3;
  }

  static info(...uris: string[]): { exists: boolean; isDirectory: boolean | null } {
    const s = statOrNull(toFsPath(uris));
    return { exists: !!s, isDirectory: s ? s.isDirectory() : null };
  }

  static join(...parts: Part[]): string {
    return parts
      .map(partString)
      .reduce((acc, next) => `${acc.replace(/\/+$/, '')}/${next.replace(/^\/+/, '')}`);
  }
  static relative(from: Part, to: Part): string {
    return posix.relative(partString(from), partString(to));
  }
  static isAbsolute(path: Part): boolean {
    const s = partString(path);
    return s.startsWith('/') || /^file:\/\//i.test(s);
  }
  static normalize(path: Part): string {
    return posix.normalize(partString(path));
  }
  static dirname(path: Part): string {
    return posix.dirname(partString(path));
  }
  static basename(path: Part, ext?: string): string {
    return posix.basename(partString(path), ext);
  }
  static extname(path: Part): string {
    return posix.extname(partString(path));
  }
  static parse(path: Part) {
    return posix.parse(partString(path));
  }
}

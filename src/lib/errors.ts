/**
 * One place for errors. Nothing the user does should crash the app or lose
 * what they typed: every failure is logged here, shown in their language,
 * and recoverable.
 *
 *  reportError   append to the local error log (never throws)
 *  friendlyMessage  translate any error into words a site supervisor understands
 *  showError     report + Alert
 *  guard         run an action, show a friendly message if it fails, never throw
 *  onErrorLogChanged  subscribe to log appends / clears (the problem screen refreshes live)
 *  installGlobalErrorHandlers  catch uncaught JS errors and promise rejections
 */
import { File, Paths } from 'expo-file-system';
import { Alert } from 'react-native';

import type { TKey } from '@/i18n';

const LOG_NAME = 'errors.log';
const LOG_MAX_BYTES = 256 * 1024;

type T = (key: TKey, vars?: Record<string, string | number>) => string;

export function errorLogFile(): File {
  return new File(Paths.document, LOG_NAME);
}

type LogListener = () => void;
const logListeners = new Set<LogListener>();

/** Called after the error log is appended to or cleared. Returns an unsubscribe function. Never throws. */
export function onErrorLogChanged(fn: LogListener): () => void {
  logListeners.add(fn);
  return () => {
    logListeners.delete(fn);
  };
}

function notifyLogChanged(): void {
  logListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // a listener must never break error reporting
    }
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Append one line to the local error log. Trims the file when it grows past LOG_MAX_BYTES. */
export function reportError(err: unknown, context: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    context,
    message: errorMessage(err),
    stack: err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 6).join('\n') : undefined,
    ...extra,
  });
  if (__DEV__) console.error(`[${context}]`, err);
  try {
    const f = errorLogFile();
    let existing = '';
    if (f.exists) {
      existing = f.textSync();
      if (existing.length > LOG_MAX_BYTES) existing = existing.slice(existing.length - LOG_MAX_BYTES / 2);
    } else {
      f.create();
    }
    f.writeSync(existing + line + '\n');
  } catch {
    // the log itself failed; nothing else to do
  }
  notifyLogChanged();
}

export function readErrorLog(): string {
  try {
    const f = errorLogFile();
    return f.exists ? f.textSync() : '';
  } catch {
    return '';
  }
}

export function clearErrorLog(): void {
  try {
    const f = errorLogFile();
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
  notifyLogChanged();
}

/** Errors that carry their own translation key (e.g. ValidationError). */
export interface KeyedError {
  key: string;
}

function hasKey(err: unknown): err is KeyedError {
  return typeof err === 'object' && err !== null && 'key' in err && typeof (err as KeyedError).key === 'string';
}

/** Turn any error into a sentence in the user's language. Never throws. */
export function friendlyMessage(err: unknown, t: T): string {
  try {
    if (hasKey(err)) return t(err.key as TKey);
    const m = errorMessage(err).toLowerCase();
    if (m === 'camera-permission') return t('cameraOff');
    if (m.includes('enospc') || m.includes('no space') || m.includes('not enough space')) return t('storageFull');
    if (m.includes('permission') || m.includes('eacces')) return t('permissionDenied');
    if (m.includes('sqlite') || m.includes('database') || m.includes('constraint')) return t('dbError');
    if (m.includes('enoent') || m.includes('no such file') || m.includes('not found')) return t('fileMissing');
    if (m.includes('network') || m.includes('econn') || m.includes('timeout')) return t('networkError');
    return t('somethingWrong');
  } catch {
    return 'Something went wrong. Nothing was lost — please try again.';
  }
}

/** Log it and tell the user, in their language. */
export function showError(err: unknown, context: string, t: T, extra?: Record<string, unknown>): void {
  reportError(err, context, extra);
  const body = friendlyMessage(err, t);
  const detail = __DEV__ ? `\n\n${errorMessage(err)}` : '';
  Alert.alert(t('errorTitle'), body + detail);
}

/**
 * Run an action that may fail (saving, files, sharing, PDF). On failure the
 * user sees a friendly message and `undefined` comes back; nothing throws.
 */
export async function guard<R>(context: string, t: T, fn: () => Promise<R> | R): Promise<R | undefined> {
  try {
    return await fn();
  } catch (err) {
    showError(err, context, t);
    return undefined;
  }
}

let installed = false;
let onFatal: ((err: Error) => void) | null = null;

/** Lets the root layout react to a fatal error (e.g. show the recovery screen). */
export function setFatalErrorListener(fn: ((err: Error) => void) | null) {
  onFatal = fn;
}

/**
 * Catch what nothing else caught: uncaught JS errors and unhandled promise
 * rejections. They are logged; fatal ones are passed to the root listener.
 */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler?: () => (e: Error, fatal?: boolean) => void; setGlobalHandler?: (h: (e: Error, fatal?: boolean) => void) => void };
  };
  const prev = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((err, fatal) => {
    reportError(err, fatal ? 'uncaught-fatal' : 'uncaught');
    if (fatal && onFatal) {
      try {
        onFatal(err);
        return; // handled: show the recovery screen instead of closing the app
      } catch {
        // fall through to the previous handler
      }
    }
    prev?.(err, fatal);
  });

  const onUnhandled = (_id: unknown, err: unknown) => reportError(err, 'unhandled-rejection');
  const hermes = (globalThis as unknown as {
    HermesInternal?: { enablePromiseRejectionTracker?: (opts: { allRejections: boolean; onUnhandled: typeof onUnhandled }) => void };
  }).HermesInternal;
  if (hermes?.enablePromiseRejectionTracker) {
    // Hermes uses its own native Promise, so the JS polyfill below never sees its rejections.
    try {
      hermes.enablePromiseRejectionTracker({ allRejections: true, onUnhandled });
      return;
    } catch {
      // fall through to the polyfill
    }
  }

  try {
    // Fallback for engines without Hermes: React Native's promise polyfill.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('promise/setimmediate/rejection-tracking') as {
      enable: (opts: { allRejections: boolean; onUnhandled: (id: number, err: unknown) => void }) => void;
    };
    tracking.enable({ allRejections: true, onUnhandled });
  } catch {
    // not available on this engine; uncaught handler above still covers errors
  }
}

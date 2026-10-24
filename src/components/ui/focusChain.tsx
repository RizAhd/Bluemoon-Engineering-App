import { createContext, useContext, useEffect, useMemo, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Keyboard, type TextInput } from 'react-native';

import { noteFocusMove } from '@/lib/keyboard';

type InputRef = RefObject<ComponentRef<typeof TextInput> | null>;

/**
 * The keyboard's Next key, done right: every field inside a Screen registers here, and Next moves to the
 * field that sits next *on the screen* (the one below, or to the right on the same line), measured at the
 * moment the key is pressed. So it follows the layout, skips fields that are hidden or read-only, and the
 * last field closes the keyboard instead of jumping back to the top (Android's own guess).
 */
export interface FocusChain {
  register: (ref: InputRef) => () => void;
  next: (from: InputRef) => void;
  /** Scrolls the screen so the focused field is in sight (set by Screen; called when focus moves with the keyboard open). */
  reveal: () => void;
}

const Ctx = createContext<FocusChain | null>(null);

function measure(ref: InputRef): Promise<{ ref: InputRef; x: number; y: number } | null> {
  return new Promise((resolve) => {
    const node = ref.current;
    if (!node?.measureInWindow) return resolve(null);
    try {
      node.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { ref, x, y } : null));
    } catch {
      resolve(null);
    }
  });
}

export function createFocusChain(reveal: () => void = () => {}): FocusChain {
  const refs = new Set<InputRef>();
  return {
    reveal,
    register(ref) {
      refs.add(ref);
      return () => {
        refs.delete(ref);
      };
    },
    next(from) {
      void Promise.all([...refs].map(measure)).then((all) => {
        const here = all.find((m) => m?.ref === from);
        if (!here) return Keyboard.dismiss();
        // the same line counts while the tops are within 8 dp (two fields side by side)
        const after = all
          .filter((m): m is NonNullable<typeof m> => !!m && m.ref !== from)
          .filter((m) => (Math.abs(m.y - here.y) < 8 ? m.x > here.x : m.y > here.y))
          .sort((a, b) => (Math.abs(a.y - b.y) < 8 ? a.x - b.x : a.y - b.y));
        const target = after[0]?.ref.current;
        if (target) {
          noteFocusMove();
          target.focus();
        } else Keyboard.dismiss();
      });
    },
  };
}

/** Wraps a screen's fields so their Next keys move through them in screen order. */
export function FocusChainProvider({ children, reveal }: { children: ReactNode; reveal?: () => void }) {
  // `reveal` reads refs only when called, so the first one is kept for the screen's life
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chain = useMemo(() => createFocusChain(reveal), []);
  return <Ctx.Provider value={chain}>{children}</Ctx.Provider>;
}

/**
 * Joins `ref` to the screen's chain. Returns the props a single-line input needs ("next" key, stay open on
 * submit, move on) — or nothing when the field is outside a Screen or the caller handles submit itself.
 */
export function useFocusChain(ref: InputRef, opts: { enabled: boolean; onSubmitEditing?: unknown; returnKeyType?: unknown }) {
  const chain = useContext(Ctx);
  const on = !!chain && opts.enabled;
  useEffect(() => (on && chain ? chain.register(ref) : undefined), [on, chain, ref]);
  // a field that handles submit itself (save on Enter) or asks for another key ("done", "search") is left alone
  if (!chain || !on || opts.onSubmitEditing || (opts.returnKeyType && opts.returnKeyType !== 'next')) return null;
  return {
    returnKeyType: 'next' as const,
    submitBehavior: 'submit' as const,
    onSubmitEditing: () => chain.next(ref),
  };
}

/** Call when a field gains focus: with the keyboard already open, the screen scrolls the field into sight. */
export function useFocusReveal(): () => void {
  const chain = useContext(Ctx);
  return () => {
    if (chain && Keyboard.isVisible()) setTimeout(chain.reveal, 50);
  };
}

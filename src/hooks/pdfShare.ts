/**
 * A screen's "make the PDF and hand it to the phone" action, for the PDF row of the Share sheet
 * (src/components/ShareSheet.tsx) and for a PDF button of the screen's own:
 *
 *   const pdf = usePdfShare({ tag: 'tools.pdf', title: t('tools'), make: (notice) => exportToolsRegisterPdf({ letterhead, onNotice: notice }) });
 *   useShareSheet({ ..., pdf: { hint, run: pdf.run } });
 *
 * `make` builds the file; `handOff` (from the Share sheet) runs once it is made, right before the phone's
 * share sheet opens, so the message about a missing letterhead is not hidden behind a sheet. One at a
 * time: a second tap while the PDF is being made does nothing. Failures are logged and shown in the
 * person's language (showError); the Share sheet then stays open for another try.
 */
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';

import { toast } from '@/components/ui/feedback';
import { useT } from '@/i18n';
import { showError } from '@/lib/errors';

type Notice = (notice: 'letterhead-unavailable') => void;

export interface PdfShareOptions {
  /** Where failures are logged, e.g. 'expenses.pdf'. */
  tag: string;
  /** The title of the phone's share sheet. */
  title: string;
  /** Makes the file; call `notice` when the letterhead could not be used. */
  make: (notice: Notice) => Promise<{ uri: string }>;
  /** Logged with a failure (ids, the choices the PDF was made with). */
  details?: Record<string, unknown>;
}

export function usePdfShare({ tag, title, make, details }: PdfShareOptions): { run: (handOff?: () => void) => Promise<void>; busy: boolean } {
  const t = useT();
  const [busy, setBusy] = useState(false);
  // A ref as well as the state: a second tap in the same frame sees the lock before the state is drawn.
  const lock = useRef(false);

  async function run(handOff?: () => void) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      let noLetterhead = false;
      const file = await make(() => (noLetterhead = true));
      handOff?.();
      if (noLetterhead) toast(t('letterheadUnavailable'), { tone: 'danger' });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
    } catch (e) {
      showError(e, tag, t, details);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return { run, busy };
}

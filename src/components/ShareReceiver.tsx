import { router } from 'expo-router';
import { useIncomingShare } from 'expo-sharing';
import { useEffect } from 'react';

/**
 * "Share to Bluemoon" from WhatsApp, Gmail or Files. A PDF opens the import
 * screen; a .zip opens restore. The payload is cleared once handled.
 */
export function ShareReceiver() {
  const { resolvedSharedPayloads, clearSharedPayloads } = useIncomingShare();

  useEffect(() => {
    const item = resolvedSharedPayloads.find((p) => p.contentUri);
    if (!item?.contentUri) return;
    const mime = item.contentMimeType ?? '';
    const name = (item.originalName ?? '').toLowerCase();
    const uri = encodeURIComponent(item.contentUri);
    if (mime === 'application/pdf' || name.endsWith('.pdf')) router.push(`/import?uri=${uri}`);
    else if (mime.includes('zip') || name.endsWith('.zip')) router.push(`/backup?uri=${uri}`);
    clearSharedPayloads();
  }, [resolvedSharedPayloads, clearSharedPayloads]);

  return null;
}

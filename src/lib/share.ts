/**
 * Hands a finished message (shareText.ts / shareLoad.ts) to the phone: to WhatsApp directly, or to the
 * share sheet, where the person picks WhatsApp, SMS, e-mail or any other app. Files (a PDF) do not go
 * through here; screens send them with expo-sharing.
 *
 * Cancelling is not an error: the person closing the share sheet comes back as 'dismissed', never as a
 * thrown error. A real failure (the phone could not open the share sheet at all) is thrown, so the
 * screen can log it and say so (guard / showError in errors.ts).
 */
import { Linking, Share } from 'react-native';

/**
 * The longest message sent straight to WhatsApp, in characters. Longer ones go to the share sheet.
 *
 * It counts the characters of the message, not of the link: a Sinhala or Tamil letter becomes 9
 * characters when encoded, so 3000 of them are about 27,000 in the link, which Android hands to WhatsApp
 * without trouble (the limit is the size of one Binder call, around 1 MB). A message that WhatsApp still
 * cannot take falls back to the share sheet like any other failure.
 */
export const WHATSAPP_MAX_CHARS = 3000;

/** 'shared': the share sheet was shown (Android cannot tell more). 'dismissed': the person closed it. */
export type ShareOutcome = 'shared' | 'dismissed';
/** 'whatsapp': WhatsApp opened with the message. 'fallback': the share sheet was used instead. 'dismissed': the person closed that. */
export type WhatsAppOutcome = 'whatsapp' | 'fallback' | 'dismissed';

/** What a cancelled share sheet looks like when a phone reports it as an error instead of a result. */
const CANCELLED = /cancel|dismiss|did not share|user closed/i;

/**
 * Open the phone's share sheet with the message. Resolves 'shared' once the sheet was shown and 'dismissed'
 * when the person closed it without sending (iOS says so; Android cannot tell and always says 'shared').
 * An empty message is not sent ('dismissed'). `title` becomes the subject of an e-mail.
 */
export async function shareText(message: string, title?: string): Promise<ShareOutcome> {
  if (!message.trim()) return 'dismissed';
  try {
    const result = await Share.share(title ? { message, title } : { message });
    return result?.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch (e) {
    if (CANCELLED.test(e instanceof Error ? e.message : String(e))) return 'dismissed';
    throw e;
  }
}

/** The link that opens WhatsApp with the text typed into a new message (the person picks the chat). */
export function whatsappUrl(message: string): string {
  return `whatsapp://send?text=${encodeURIComponent(message)}`;
}

/**
 * Open WhatsApp with the message ready to send: 'whatsapp'. When WhatsApp cannot be opened (not installed,
 * the link refused), or the message is longer than WHATSAPP_MAX_CHARS, the share sheet is used instead:
 * 'fallback' once it was shown, 'dismissed' when the person closed it. Does not ask whether WhatsApp is
 * installed first (Android 11 and later hide other apps from canOpenURL); it just tries.
 */
export async function shareToWhatsApp(message: string): Promise<WhatsAppOutcome> {
  if (!message.trim()) return 'dismissed';
  const viaSheet = async (): Promise<WhatsAppOutcome> => ((await shareText(message)) === 'dismissed' ? 'dismissed' : 'fallback');

  if (message.length > WHATSAPP_MAX_CHARS) return viaSheet();
  try {
    await Linking.openURL(whatsappUrl(message));
    return 'whatsapp';
  } catch {
    // WhatsApp is not installed, the phone refused the link, or the text could not be encoded (a lone surrogate)
    return viaSheet();
  }
}

/**
 * Handing a message to the phone: the share sheet and WhatsApp. React Native's Share and Linking are
 * doubles here, so these tests say what the app asks the phone to do, and what it tells the screen
 * when the phone says no or the person changes their mind.
 */
import { Linking, Share } from 'react-native';

import { shareText, shareToWhatsApp, whatsappUrl, WHATSAPP_MAX_CHARS } from '@/lib/share';
import { SHARE_LABELS } from '@/lib/shareLabels';
import { projectMessage, type ProjectShareInput } from '@/lib/shareText';

const shareSheet = jest.spyOn(Share, 'share');
const openURL = jest.mocked(Linking.openURL);
const canOpenURL = jest.mocked(Linking.canOpenURL);

const SHARED = { action: Share.sharedAction, activityType: undefined };
const DISMISSED = { action: Share.dismissedAction, activityType: undefined };

beforeEach(() => {
  shareSheet.mockReset();
  shareSheet.mockResolvedValue(SHARED);
  openURL.mockReset();
  openURL.mockResolvedValue(undefined);
  canOpenURL.mockClear();
});

const sinhala = (n: number) => 'ක්‍ෂා'.repeat(Math.ceil(n / 4)).slice(0, n);

describe('shareText: the share sheet', () => {
  it('asks the phone to share the message with its title and says it was shared', async () => {
    await expect(shareText('*Estimate EST-1*\nTotal: Rs 5', 'Estimate EST-1')).resolves.toBe('shared');
    expect(shareSheet).toHaveBeenCalledTimes(1);
    expect(shareSheet).toHaveBeenCalledWith({ message: '*Estimate EST-1*\nTotal: Rs 5', title: 'Estimate EST-1' });
  });

  it('without a title there is no title in the request', async () => {
    await shareText('Hello');
    expect(shareSheet).toHaveBeenCalledWith({ message: 'Hello' });
    expect(Object.keys(shareSheet.mock.calls[0][0])).toEqual(['message']);
  });

  it('sends Sinhala, Tamil and line breaks as they are', async () => {
    const text = '*වැඩ සහ ගෙවීම්*\nதேதி: 22 Oct 2026\n\nRs 3,500';
    await shareText(text);
    expect(shareSheet).toHaveBeenCalledWith({ message: text });
  });

  it('closing the sheet is not an error: it comes back as "dismissed" (iOS reports it)', async () => {
    shareSheet.mockResolvedValue(DISMISSED);
    await expect(shareText('Hello')).resolves.toBe('dismissed');
  });

  it('closing the sheet is not an error when the phone reports it as a failure with such a message', async () => {
    for (const message of ['User did not share', 'The user canceled the sharing', 'Share dismissed']) {
      shareSheet.mockRejectedValueOnce(new Error(message));
      await expect(shareText('Hello')).resolves.toBe('dismissed');
    }
    shareSheet.mockRejectedValueOnce('cancelled');
    await expect(shareText('Hello')).resolves.toBe('dismissed');
  });

  it('a real failure is thrown, so the screen can log it and tell the person', async () => {
    shareSheet.mockRejectedValueOnce(new Error('Failed to open share dialog'));
    await expect(shareText('Hello')).rejects.toThrow('Failed to open share dialog');
  });

  it('a phone that answers with nothing still counts as shared', async () => {
    shareSheet.mockResolvedValue(undefined as never);
    await expect(shareText('Hello')).resolves.toBe('shared');
  });

  it('a message with nothing in it is not sent', async () => {
    await expect(shareText('')).resolves.toBe('dismissed');
    await expect(shareText('  \n ')).resolves.toBe('dismissed');
    expect(shareSheet).not.toHaveBeenCalled();
  });
});

describe('whatsappUrl', () => {
  it('is whatsapp://send with the whole message encoded, so line breaks, & # ? % and + survive', () => {
    const text = '*Title*\nTotal: Rs 1,250 & 50% off? #1 + more';
    const url = whatsappUrl(text);
    expect(url.startsWith('whatsapp://send?text=')).toBe(true);
    expect(url).not.toMatch(/[\n &#+]/);
    expect(url).toContain('%0A');
    expect(decodeURIComponent(url.slice('whatsapp://send?text='.length))).toBe(text);
  });
});

describe('shareToWhatsApp', () => {
  it('opens WhatsApp with the message typed in, and never opens the share sheet', async () => {
    const text = '*Welimada Primary School Building*\nTotal cost: Rs 557,350';
    await expect(shareToWhatsApp(text)).resolves.toBe('whatsapp');
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(`whatsapp://send?text=${encodeURIComponent(text)}`);
    expect(shareSheet).not.toHaveBeenCalled();
  });

  it('does not ask whether WhatsApp is installed first (Android 11 and later would say no); it just tries', async () => {
    await shareToWhatsApp('Hello');
    expect(canOpenURL).not.toHaveBeenCalled();
  });

  it('Sinhala and Tamil text reaches WhatsApp unchanged', async () => {
    const text = `*ඇස්තමේන්තුව EST-2026-014*\nவாடிக்கையாளர்: Mr. K. A. Perera\n${sinhala(100)}`;
    await shareToWhatsApp(text);
    const url = openURL.mock.calls[0][0];
    expect(decodeURIComponent(url.slice('whatsapp://send?text='.length))).toBe(text);
  });

  it('goes to the share sheet when WhatsApp cannot be opened (not installed): "fallback"', async () => {
    openURL.mockRejectedValue(new Error("Could not open URL 'whatsapp://send?text=Hello': No Activity found to handle Intent"));
    await expect(shareToWhatsApp('Hello')).resolves.toBe('fallback');
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(shareSheet).toHaveBeenCalledTimes(1);
    expect(shareSheet).toHaveBeenCalledWith({ message: 'Hello' });
  });

  it('also when opening the link fails at once instead of later', async () => {
    openURL.mockImplementation(() => {
      throw new Error('Linking is not available');
    });
    await expect(shareToWhatsApp('Hello')).resolves.toBe('fallback');
    expect(shareSheet).toHaveBeenCalledWith({ message: 'Hello' });
  });

  it('if the person then closes the share sheet: "dismissed", not an error', async () => {
    openURL.mockRejectedValue(new Error('No Activity found'));
    shareSheet.mockResolvedValue(DISMISSED);
    await expect(shareToWhatsApp('Hello')).resolves.toBe('dismissed');
    shareSheet.mockRejectedValueOnce(new Error('User did not share'));
    await expect(shareToWhatsApp('Hello')).resolves.toBe('dismissed');
  });

  it('is an error only when WhatsApp and the share sheet both fail', async () => {
    openURL.mockRejectedValue(new Error('No Activity found'));
    shareSheet.mockRejectedValue(new Error('Failed to open share dialog'));
    await expect(shareToWhatsApp('Hello')).rejects.toThrow('Failed to open share dialog');
  });

  it(`sends ${WHATSAPP_MAX_CHARS} characters to WhatsApp and anything longer to the share sheet`, async () => {
    expect(WHATSAPP_MAX_CHARS).toBe(3000);
    const atLimit = 'a'.repeat(WHATSAPP_MAX_CHARS);
    await expect(shareToWhatsApp(atLimit)).resolves.toBe('whatsapp');
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(shareSheet).not.toHaveBeenCalled();

    openURL.mockClear();
    const over = 'a'.repeat(WHATSAPP_MAX_CHARS + 1);
    await expect(shareToWhatsApp(over)).resolves.toBe('fallback');
    expect(openURL).not.toHaveBeenCalled();
    expect(shareSheet).toHaveBeenCalledWith({ message: over });
  });

  it('the limit counts characters, not the longer link: 3000 Sinhala letters still go to WhatsApp (about 27,000 characters encoded)', async () => {
    const text = sinhala(WHATSAPP_MAX_CHARS);
    expect(text).toHaveLength(WHATSAPP_MAX_CHARS);
    await expect(shareToWhatsApp(text)).resolves.toBe('whatsapp');
    const url = openURL.mock.calls[0][0];
    expect(url.length).toBeGreaterThan(20_000);
    expect(decodeURIComponent(url.slice('whatsapp://send?text='.length))).toBe(text);
  });

  it('a message that is too long and then closed in the share sheet is "dismissed"', async () => {
    shareSheet.mockResolvedValue(DISMISSED);
    await expect(shareToWhatsApp('a'.repeat(WHATSAPP_MAX_CHARS + 1))).resolves.toBe('dismissed');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('text that cannot be made into a link (half an emoji) goes through the share sheet instead of failing', async () => {
    const broken = 'Total \uD83D cost';
    expect(() => encodeURIComponent(broken)).toThrow();
    await expect(shareToWhatsApp(broken)).resolves.toBe('fallback');
    expect(openURL).not.toHaveBeenCalled();
    expect(shareSheet).toHaveBeenCalledWith({ message: broken });
  });

  it('a message with nothing in it is not sent anywhere', async () => {
    await expect(shareToWhatsApp('')).resolves.toBe('dismissed');
    await expect(shareToWhatsApp('   ')).resolves.toBe('dismissed');
    expect(openURL).not.toHaveBeenCalled();
    expect(shareSheet).not.toHaveBeenCalled();
  });

  it('never throws because the person changed their mind, whichever way the phone reports it', async () => {
    openURL.mockRejectedValue(new Error('No Activity found'));
    for (const closed of [() => shareSheet.mockResolvedValueOnce(DISMISSED), () => shareSheet.mockRejectedValueOnce(new Error('User did not share'))]) {
      closed();
      await expect(shareToWhatsApp('Hello')).resolves.toBe('dismissed');
    }
  });

  it('carries a finished project message to WhatsApp as it is', async () => {
    const project: ProjectShareInput = {
      today: '2026-10-22',
      project: { name: 'Site A', client: null, location: null, status: 'active', contract_cents: null },
      cost: { expense_cents: 100_000, labour_cents: 0, labour_paid_cents: 0 },
      categories: [],
      workerCount: 1,
      toolsOutCount: 0,
      notes: [],
      noteCount: 0,
    };
    for (const lang of ['en', 'si', 'ta'] as const) {
      openURL.mockClear();
      const text = projectMessage(project, lang);
      await expect(shareToWhatsApp(text)).resolves.toBe('whatsapp');
      expect(decodeURIComponent(openURL.mock.calls[0][0].slice('whatsapp://send?text='.length))).toBe(text);
      expect(text).toContain(SHARE_LABELS[lang].footer);
    }
  });
});

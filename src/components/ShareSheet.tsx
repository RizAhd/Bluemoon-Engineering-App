/**
 * The one Share button of a screen and the bottom sheet behind it.
 *
 *   const share = useShareSheet({ kind: 'project', id: project.id, pdf });
 *   <Stack.Screen options={{ headerRight: () => <ShareHeaderButton onPress={share.open} /> }} />
 *   ...
 *   {share.sheet}
 *
 * Opening the sheet builds the message once (buildShareMessage, in the app's language unless the screen
 * passes another, as the estimate does with the client's language). The language switch at the top writes
 * it again in another language. What the preview shows is exactly what is sent. The tiles hand it on:
 *   WhatsApp     shareToWhatsApp; when WhatsApp cannot be opened the phone's share sheet is used and a short
 *                message says so
 *   Other apps   the phone's share sheet (SMS, e-mail, any app), with the message's first line as the subject
 *   PDF          only when the screen has one: the screen's own PDF export, with its remembered choices
 *
 * One thing at a time: while a tile is working every tile is disabled and the sheet cannot be closed (closing
 * it would hide the only sign that something is happening). The sheet closes once the message or the file
 * was handed to the phone; a share sheet the person closed leaves it open for another choice. Failures are
 * logged and shown in the person's language (showError).
 */
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { FileText, MessageCircle, Share2 } from 'lucide-react-native';
import { useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { HeaderButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { BottomSheet, Segmented, SheetHeader } from '@/components/ui/form';
import { Txt } from '@/components/ui/Txt';
import { LANG_NAMES, useLang, useT, type Lang } from '@/i18n';
import { showError } from '@/lib/errors';
import { shareText, shareToWhatsApp } from '@/lib/share';
import { buildShareMessage, type ShareKind, type ShareOptions } from '@/lib/shareLoad';
import { messageTitle } from '@/lib/shareText';
import { hairline, radius, space, useColors, type Palette } from '@/theme';

/** How many lines of the message the preview shows. */
export const PREVIEW_LINES = 3;

/** The screen's PDF, offered as the last tile of the sheet. */
export interface SharePdf {
  /** One line under the tile: the remembered choices the PDF is made with ("English · Plain paper"). */
  hint?: string;
  /**
   * Make the PDF and hand it to the phone (expo-sharing). Call `handOff` once the file is made, right before
   * the phone's share sheet opens: it closes this sheet, so a message about the PDF is not hidden behind it.
   * The screen reports its own failures; anything it throws is reported here. When `handOff` is never called
   * (the export failed) the sheet stays open.
   */
  run: (handOff: () => void) => Promise<void>;
}

/** What the Share button sends. `id` and `options` are those of buildShareMessage. */
export interface ShareTarget {
  kind: ShareKind;
  id: string | null;
  /** The language of the message; the app's language when left out. */
  lang?: Lang;
  options?: ShareOptions;
  pdf?: SharePdf;
}

type Busy = 'whatsapp' | 'other' | 'pdf';

/** The first lines of the message as the person reads them in the chat (WhatsApp's bold stars left out). */
export function previewOf(message: string, lines = PREVIEW_LINES): string {
  return message
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, lines)
    .map((line) => line.replace(/\*/g, '').trim())
    .join('\n');
}

/** The tint of each way to send: WhatsApp green, other apps blue, the PDF red (always beside its name). */
const TILE_TONE: Record<Busy, { bg: keyof Palette; fg: keyof Palette }> = {
  whatsapp: { bg: 'successSoft', fg: 'success' },
  other: { bg: 'primarySoft', fg: 'primary' },
  pdf: { bg: 'dangerSoft', fg: 'danger' },
};

/** One way to send, as a tile: icon, name, a short hint. A spinner on the tile that is working, the others disabled meanwhile. */
function ShareRow({ which, busy, icon: Icon, title, subtitle, onPress }: { which: Busy; busy: Busy | null; icon: LucideIcon; title: string; subtitle: string; onPress: () => void }) {
  const c = useColors();
  const t = useT();
  const working = busy === which;
  const off = busy != null && !working;
  const tone = TILE_TONE[which];
  return (
    <Pressable
      testID={`share-row-${which}`}
      accessibilityRole="button"
      accessibilityLabel={working ? `${title}. ${t('shareWorking')}` : title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled: off, busy: working }}
      disabled={off}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 112,
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.md,
        paddingHorizontal: space.sm,
        borderRadius: radius.lg - 4,
        backgroundColor: pressed ? c.muted : c.surface2,
      })}>
      <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: c[tone.bg], alignItems: 'center', justifyContent: 'center' }}>
        {working ? <ActivityIndicator color={c[tone.fg]} accessibilityLabel={t('shareWorking')} /> : <Icon size={22} color={off ? c.placeholder : c[tone.fg]} strokeWidth={2} />}
      </View>
      <Txt weight="bold" center numberOfLines={1} color={off ? 'textMuted' : 'text'}>
        {title}
      </Txt>
      <Txt variant="caption" color="textMuted" center numberOfLines={3}>
        {subtitle}
      </Txt>
    </Pressable>
  );
}

export interface ShareSheetProps {
  visible: boolean;
  /** The finished message (buildShareMessage). */
  message: string;
  /** The language it is written in, named in the caption. */
  lang: Lang;
  /** Where the failures are logged: `share.<kind>`. */
  kind: ShareKind;
  pdf?: SharePdf;
  onClose: () => void;
  /** Offers the three languages above the preview: the message is written again in the one chosen. */
  onLang?: (lang: Lang) => void;
}

/** The bottom sheet: caption with the language, the language switch, a preview of the message, then WhatsApp · Other apps · PDF. */
export function ShareSheet({ visible, message, lang, kind, pdf, onClose, onLang }: ShareSheetProps) {
  const c = useColors();
  const t = useT();
  const [busy, setBusy] = useState<Busy | null>(null);
  // A ref as well as the state: a second tap in the same frame sees the lock before the state is drawn.
  const lock = useRef(false);

  const close = busy ? () => undefined : onClose;

  async function run(which: Busy, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(which);
    try {
      await work();
    } catch (e) {
      showError(e, `share.${kind}.${which}`, t, { length: message.length, lang });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const toWhatsApp = () =>
    run('whatsapp', async () => {
      const outcome = await shareToWhatsApp(message);
      if (outcome === 'dismissed') return;
      // the sheet goes first: a message shown while it is open would sit behind it
      onClose();
      if (outcome === 'fallback') toast(t('whatsappMissing'));
    });

  const toOtherApps = () =>
    run('other', async () => {
      const outcome = await shareText(message, messageTitle(message) || undefined);
      if (outcome === 'shared') onClose();
    });

  const toPdf = () =>
    run('pdf', async () => {
      if (pdf) await pdf.run(onClose);
    });

  return (
    <BottomSheet visible={visible} onClose={close}>
      <SheetHeader title={t('shareTitle')} onClose={close} caption={t('sharePreview', { lang: LANG_NAMES[lang] })} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.lg }}>
        {onLang ? (
          <Segmented<Lang>
            value={lang}
            onChange={(l) => {
              if (!busy && l !== lang) onLang(l);
            }}
            options={(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          />
        ) : null}
        {/* what goes out: the first lines, as the chat will show them */}
        <View
          accessibilityLabel={`${t('sharePreview', { lang: LANG_NAMES[lang] })}: ${previewOf(message)}`}
          style={{ backgroundColor: c.surface2, borderRadius: radius.md, borderWidth: hairline, borderColor: c.border, padding: space.lg }}>
          <Txt numberOfLines={PREVIEW_LINES} testID="share-preview">
            {previewOf(message)}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <ShareRow which="whatsapp" busy={busy} icon={MessageCircle} title={t('viaWhatsApp')} subtitle={t('viaWhatsAppHint')} onPress={() => void toWhatsApp()} />
          <ShareRow which="other" busy={busy} icon={Share2} title={t('otherApps')} subtitle={t('otherAppsHint')} onPress={() => void toOtherApps()} />
          {pdf ? <ShareRow which="pdf" busy={busy} icon={FileText} title={t('sharePdf')} subtitle={pdf.hint || t('sharePdfHint')} onPress={() => void toPdf()} /> : null}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

/** The Share icon button for a white stack header: 44 dp, boxed, like the other header actions. */
export function ShareHeaderButton({ onPress }: { onPress: () => void }) {
  const t = useT();
  return <HeaderButton icon={Share2} label={t('share')} onPress={onPress} />;
}

/**
 * A screen's Share button: `open` builds the message and shows the sheet, `sheet` is rendered once
 * anywhere in the screen. A message that cannot be built (the record is gone) says so in a toast.
 */
export function useShareSheet(target: ShareTarget): { open: () => void; sheet: ReactElement } {
  const t = useT();
  const appLang = useLang();
  const [shown, setShown] = useState<{ message: string; lang: Lang } | null>(null);
  const [visible, setVisible] = useState(false);
  const lang = target.lang ?? appLang;

  /** Build the message in `l` and show it in the sheet; false when there is nothing to send (said in a toast). */
  function build(l: Lang): boolean {
    try {
      const message = buildShareMessage(target.kind, target.id, l, target.options);
      if (!message) {
        toast(t('nothingToShare'), { tone: 'danger' });
        return false;
      }
      setShown({ message, lang: l });
      return true;
    } catch (e) {
      showError(e, `share.${target.kind}.build`, t, { id: target.id, lang: l });
      return false;
    }
  }

  function open() {
    if (build(lang)) setVisible(true);
  }

  const sheet = (
    <ShareSheet
      visible={visible && !!shown}
      message={shown?.message ?? ''}
      lang={shown?.lang ?? lang}
      kind={target.kind}
      pdf={target.pdf}
      onClose={() => setVisible(false)}
      onLang={(l) => void build(l)}
    />
  );
  return { open, sheet };
}

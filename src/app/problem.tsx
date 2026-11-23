import { useFocusEffect } from 'expo-router';
import { Bug, CheckCircle2, Share2, Trash2 } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { shareErrorLog } from '@/components/ErrorScreen';
import { Button } from '@/components/ui/Button';
import { CardList, type CardSection } from '@/components/ui/CardList';
import { EmptyState, toast } from '@/components/ui/feedback';
import { Card, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useLang, useT } from '@/i18n';
import { formatDay, toDay, today } from '@/lib/dates';
import { clearErrorLog, guard, onErrorLogChanged, readErrorLog } from '@/lib/errors';
import { space } from '@/theme';

interface LogEntry {
  key: string;
  at: Date | null;
  day: string;
  context: string;
  message: string;
  stack?: string;
  extra: string;
}

/** One JSON object per line (see reportError). A line that is not JSON is still shown, never dropped. */
function parseLog(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw) return;
    let at: Date | null = null;
    let context = 'log';
    let message = raw;
    let stack: string | undefined;
    const extras: string[] = [];
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (typeof o.at === 'string') {
        const d = new Date(o.at);
        at = Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof o.context === 'string' && o.context) context = o.context;
      message = typeof o.message === 'string' ? o.message : JSON.stringify(o.message ?? '');
      if (typeof o.stack === 'string' && o.stack) stack = o.stack;
      Object.entries(o).forEach(([k, v]) => {
        if (k === 'at' || k === 'context' || k === 'message' || k === 'stack' || v == null) return;
        extras.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      });
    } catch {
      // not JSON: keep the raw line as the message
    }
    out.push({ key: `${i}`, at, day: at ? toDay(at) : '', context, message, stack, extra: extras.join('\n') });
  });
  return out.reverse(); // newest first
}

function timeOf(d: Date | null) {
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** Report a problem: the local error log, newest first, with Share and Clear. */
export default function ProblemScreen() {
  const t = useT();
  const lang = useLang();
  const [text, setText] = useState('');
  const [sharing, setSharing] = useState(false);

  // Re-read whenever the screen is shown, and live while it is open (an error may be logged any time).
  useFocusEffect(
    useCallback(() => {
      setText(readErrorLog());
      return onErrorLogChanged(() => setText(readErrorLog()));
    }, []),
  );

  const entries = useMemo(() => parseLog(text), [text]);
  const groups = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    entries.forEach((e) => map.set(e.day, [...(map.get(e.day) ?? []), e]));
    return [...map.entries()];
  }, [entries]);

  async function share() {
    if (sharing) return;
    setSharing(true);
    await guard('problem.share', t, () => shareErrorLog(lang));
    setSharing(false);
  }

  function confirmClear() {
    Alert.alert(t('clearLog'), t('clearLogBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('clearLog'),
        style: 'destructive',
        onPress: () => {
          void guard('problem.clear', t, () => {
            clearErrorLog();
            setText('');
            toast(t('deleted'));
          });
        },
      },
    ]);
  }

  function show(e: LogEntry) {
    const when = e.at ? `${formatDay(e.day)} ${timeOf(e.at)}` : '';
    const body = [when, e.message, e.extra, e.stack].filter(Boolean).join('\n\n');
    Alert.alert(e.context, body, [{ text: t('close') }]);
  }

  const dayLabel = (day: string) => (day === today() ? t('today') : day ? formatDay(day) : t('errorLog'));

  const sections: CardSection<LogEntry>[] = groups.map(([day, rows]) => ({ key: day || 'none', label: `${dayLabel(day)} (${rows.length})`, rows }));

  return (
    <Screen scroll={false}>
      <CardList
        sections={sections}
        keyOf={entryKey}
        renderRow={(e) => <LogRow e={e} onPress={show} />}
        inset
        empty={<EmptyState icon={CheckCircle2} title={t('noErrors')} hint={t('appCrashedBody')} />}
        stickyFooter={
          entries.length ? (
            <View style={{ gap: space.sm }}>
              <Button icon={Share2} label={t('shareLog')} onPress={() => void share()} loading={sharing} full />
              <Button kind="danger" icon={Trash2} label={t('clearLog')} onPress={confirmClear} disabled={sharing} full />
            </View>
          ) : undefined
        }
        header={
          entries.length ? (
            <Card gap={space.xs}>
              <Txt eyebrow>{t('errorLog')}</Txt>
              <Txt variant="caption" color="textMuted">
                {t('appCrashedBody')}
              </Txt>
              <Txt variant="caption" weight="semibold" numeric>
                {`${entries.length} ${t('records')}`}
              </Txt>
            </Card>
          ) : null
        }
      />
    </Screen>
  );
}

const entryKey = (e: LogEntry) => e.key;

/** One logged error: where it happened, the message, the time. */
const LogRow = memo(function LogRow({ e, onPress }: { e: LogEntry; onPress: (e: LogEntry) => void }) {
  return <ListRow icon={Bug} iconTone="danger" title={e.context} subtitle={e.message} value={timeOf(e.at)} onPress={() => onPress(e)} accessibilityLabel={`${e.context}: ${e.message}`} />;
});

/**
 * A project's site notes as HTML, for expo-print (pdfShell.ts): day, weather and the note, newest day
 * first, as the Site notes screen lists them. Pure: the notes are printed as they are (line breaks kept).
 */
import type { TKey } from '@/i18n';

import { formatDay } from '../dates';
import { esc, h2, pageHtml, remark } from '../pdfShell';

export interface NoteLine {
  day: string;
  /** 'sunny' | 'cloudy' | 'rain'; anything else is not shown. */
  weather: string | null;
  body: string;
  project_name: string | null;
}

export interface NotesHtmlInput {
  /** The project, or null for all projects. */
  projectName: string | null;
  /** Newest day first. */
  notes: NoteLine[];
  letterhead: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** Local calendar day printed on the page, "YYYY-MM-DD". */
  day: string;
}

const WEATHER = new Set(['sunny', 'cloudy', 'rain']);

export function buildNotesHtml(input: NotesHtmlInput): string {
  const { notes, letterhead, day } = input;
  const t = (k: TKey) => esc(input.t(k));
  const allProjects = input.projectName == null;

  const sections: string[] = [];
  sections.push(h2(t('siteNotes'), notes.length));
  if (notes.length) {
    const head = `<tr><th style="width:18%">${t('date')}</th>${allProjects ? `<th style="width:20%">${t('project')}</th>` : ''}<th style="width:13%">${t('weather')}</th><th>${t('note')}</th></tr>`;
    const rows = notes
      .map(
        (n) =>
          `<tr><td class="when">${esc(formatDay(n.day))}</td>${allProjects ? `<td>${esc(n.project_name ?? '')}</td>` : ''}<td>${
            n.weather && WEATHER.has(n.weather) ? t(`weather_${n.weather}` as TKey) : ''
          }</td><td class="pre">${esc(n.body.replace(/\r\n?/g, '\n'))}</td></tr>`,
      )
      .join('');
    sections.push(`<table class="data notes"><thead>${head}</thead><tbody>${rows}</tbody></table>`);
  } else {
    sections.push(remark(t('noNotes')));
  }

  return pageHtml({
    title: input.t('siteNotes'),
    subtitle: input.projectName ?? input.t('allProjects'),
    kicker: `${input.t('pdfNotes')} · ${formatDay(day)}`,
    letterhead,
    body: sections.join('\n      '),
    footer: `${input.t('pdfFooter')} · ${input.t('printedOn', { date: formatDay(day) })}`,
  });
}

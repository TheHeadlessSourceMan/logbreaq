const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface JournalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function parseJournalFileName(fileName: string): JournalDate | undefined {
  const match = /^(\d{4})_(\d{2})_(\d{2})\.md$/i.exec(fileName);
  if (match === null) {
    return undefined;
  }
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return probe.getUTCMonth() === date.month - 1 && probe.getUTCDate() === date.day ? date : undefined;
}

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

/** Formats a journal title using the subset of date-fns tokens Logseq commonly uses. */
export function formatJournalTitle(date: JournalDate, format: string): string {
  const weekday = WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]!;
  const month = MONTHS[date.month - 1]!;
  return format.replace(/yyyy|yy|MMMM|MMM|MM|M|do|dd|d|EEEE|EEE|EE|E/g, (token) => {
    switch (token) {
      case 'yyyy': return String(date.year);
      case 'yy': return String(date.year % 100).padStart(2, '0');
      case 'MMMM': return month;
      case 'MMM': return month.slice(0, 3);
      case 'MM': return String(date.month).padStart(2, '0');
      case 'M': return String(date.month);
      case 'do': return ordinal(date.day);
      case 'dd': return String(date.day).padStart(2, '0');
      case 'd': return String(date.day);
      case 'EEEE': return weekday;
      default: return weekday.slice(0, 3);
    }
  });
}

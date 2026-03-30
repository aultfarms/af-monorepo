const reportBoundaryFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const rowDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const monthYearFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
});

const gallonsFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function getPreviousMonthYear(base: Date = new Date()) {
  const previous = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  return {
    month: previous.getMonth() + 1,
    year: previous.getFullYear(),
  };
}

export function getReportWindow(reportMonth: number, reportYear: number) {
  const start = new Date(reportYear, reportMonth - 2, 21, 0, 0, 0, 0);
  const end = new Date(reportYear, reportMonth - 1, 20, 23, 59, 59, 999);
  return { start, end };
}

export function parseLegacyDate(dateDay: string, dateTime: string) {
  const normalizedDay = `${dateDay}`.trim();
  const normalizedTime = `${dateTime}`.trim();
  const year = Number(normalizedDay.slice(0, 4));
  const month = Number(normalizedDay.slice(4, 6));
  const day = Number(normalizedDay.slice(6, 8));
  const [hourStr = '0', minuteStr = '0'] = normalizedTime.split(':');
  return new Date(year, month - 1, day, Number(hourStr), Number(minuteStr), 0, 0);
}

export function formatReportBoundary(date: Date) {
  return reportBoundaryFormatter.format(date);
}

export function formatRowDateTime(date: Date) {
  return rowDateTimeFormatter.format(date);
}

export function formatMonthYearLabel(reportMonth: number, reportYear: number) {
  return monthYearFormatter.format(new Date(reportYear, reportMonth - 1, 1));
}

export function formatGallons(gallons: number) {
  return gallonsFormatter.format(gallons);
}

export function toFileStem(reportMonth: number, reportYear: number) {
  return `${reportYear}-${String(reportMonth).padStart(2, '0')}`;
}

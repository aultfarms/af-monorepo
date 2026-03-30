import JSZip from 'jszip';
import { formatRowDateTime, parseLegacyDate } from './date';
import type { FuelTransaction, LoadedExportSummary } from './types';

const CSV_COLUMN_HEADINGS = [
  'personpin',
  'vehicleid',
  'date_day',
  'date_time',
  'trans_number',
  'dontknow',
  'always_001',
  'pump_is_middle_digit',
  'rule_num',
  'gallons',
  'price_per_gallon',
  'always_0',
  'always_emptystr',
  'always_001',
  'always_emptystr',
  'person_shortname',
  'vehicle_shortname',
  'always_spaces',
  'always_emptystr',
  'always_0',
  'always_emptystr',
  'always_space',
  'always_I',
];

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function normalizeString(value: string | undefined) {
  return (value || '').trim().toLowerCase();
}

function parseCsvText(csvText: string, sourceFile: string) {
  const transactions: FuelTransaction[] = [];
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);

  lines.forEach((line, index) => {
    const columns = parseCsvLine(line);
    if (columns.length < CSV_COLUMN_HEADINGS.length) {
      return;
    }

    const dateDay = `${columns[2] || ''}`.trim();
    const dateTime = `${columns[3] || ''}`.trim();
    if (!dateDay || !dateTime) {
      return;
    }

    const pumpRaw = `${columns[7] || ''}`;
    const pumpNumber = pumpRaw.charAt(1);
    const gallons = Number(columns[9] || 0);
    const pricePerGallon = Number(columns[10] || 0);

    transactions.push({
      personPin: `${columns[0] || ''}`.trim(),
      vehicleId: `${columns[1] || ''}`.trim(),
      dateDay,
      dateTime,
      transactionNumber: `${columns[4] || ''}`.trim(),
      gallons: Number.isFinite(gallons) ? gallons : 0,
      pricePerGallon: Number.isFinite(pricePerGallon) ? pricePerGallon : 0,
      personShortname: normalizeString(columns[15]),
      vehicleShortname: normalizeString(columns[16]),
      pumpNumber,
      date: parseLegacyDate(dateDay, dateTime),
      sourceFile,
      rawLineNumber: index + 1,
    });
  });

  return transactions;
}

export async function parseFuelExportsZipFile(file: File): Promise<{
  transactions: FuelTransaction[];
  summary: LoadedExportSummary;
}> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files)
    .filter(entry => !entry.dir && entry.name.toLowerCase().endsWith('.csv'))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length < 1) {
    throw new Error('The ZIP file does not contain any CSV fuel exports.');
  }

  let transactions: FuelTransaction[] = [];
  for (const entry of entries) {
    const text = await entry.async('text');
    transactions = [
      ...transactions,
      ...parseCsvText(text, entry.name.split('/').pop() || entry.name),
    ];
  }

  transactions.sort((left, right) => left.date.getTime() - right.date.getTime());

  if (transactions.length < 1) {
    throw new Error('The ZIP file contained CSVs, but no transaction rows could be parsed from them.');
  }

  const first = transactions[0]!;
  const last = transactions[transactions.length - 1]!;

  return {
    transactions,
    summary: {
      fileName: file.name,
      csvFileCount: entries.length,
      transactionCount: transactions.length,
      minDateText: formatRowDateTime(first.date),
      maxDateText: formatRowDateTime(last.date),
    },
  };
}

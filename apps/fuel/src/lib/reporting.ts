import { formatReportBoundary, toFileStem } from './date';
import { getReportWindow } from './date';
import type {
  FuelReport,
  FuelReportEntry,
  FuelReportGroupSection,
  FuelReportPumpSection,
  FuelSettings,
  FuelTransaction,
} from './types';

class FuelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuelConfigurationError';
  }
}

export class MissingPersonError extends FuelConfigurationError {
  shortId: string;

  constructor(shortId: string) {
    super(`Missing person "${shortId}" in fuel report settings.`);
    this.name = 'MissingPersonError';
    this.shortId = shortId;
  }
}

export class MissingVehicleError extends FuelConfigurationError {
  shortId: string;

  constructor(shortId: string) {
    super(`Missing vehicle "${shortId}" in fuel report settings.`);
    this.name = 'MissingVehicleError';
    this.shortId = shortId;
  }
}

export class MissingGroupError extends FuelConfigurationError {
  groupId: string;

  constructor(groupId: string) {
    super(`Missing group "${groupId}" in fuel report settings.`);
    this.name = 'MissingGroupError';
    this.groupId = groupId;
  }
}

export class MissingPumpError extends FuelConfigurationError {
  pumpId: string;

  constructor(pumpId: string) {
    super(`Missing pump "${pumpId}" in fuel report settings.`);
    this.name = 'MissingPumpError';
    this.pumpId = pumpId;
  }
}

export class MissingGroupAssignmentError extends FuelConfigurationError {
  personId: string;
  vehicleId: string;

  constructor(personId: string, vehicleId: string) {
    super(`No group is assigned for person "${personId}" or vehicle "${vehicleId}".`);
    this.name = 'MissingGroupAssignmentError';
    this.personId = personId;
    this.vehicleId = vehicleId;
  }
}

function bucketByKey<T>(items: T[], getKey: (item: T) => string) {
  const buckets = new Map<string, T[]>();
  items.forEach(item => {
    const key = getKey(item);
    const existing = buckets.get(key);
    if (existing) {
      existing.push(item);
      return;
    }
    buckets.set(key, [item]);
  });
  return buckets;
}

function buildPumpSections(transactions: FuelTransaction[], settings: FuelSettings): FuelReportPumpSection[] {
  const pumpBuckets = bucketByKey(transactions, transaction => transaction.pumpNumber);
  const pumpSections: FuelReportPumpSection[] = [];

  for (const [pumpId, pumpTransactions] of pumpBuckets.entries()) {
    const pump = settings.pumpsById[pumpId];
    if (!pump) {
      throw new MissingPumpError(pumpId);
    }

    const entries: FuelReportEntry[] = pumpTransactions.map(transaction => {
      const person = settings.peopleById[transaction.personShortname];
      if (!person) {
        throw new MissingPersonError(transaction.personShortname);
      }

      const vehicle = settings.vehiclesById[transaction.vehicleShortname];
      if (!vehicle) {
        throw new MissingVehicleError(transaction.vehicleShortname);
      }

      return {
        date: transaction.date,
        personName: person.name,
        vehicleName: vehicle.name,
        gallons: transaction.gallons,
      };
    });

    pumpSections.push({
      pumpId,
      pumpName: pump.name,
      entries,
      totalGallons: entries.reduce((total, entry) => total + entry.gallons, 0),
    });
  }

  return pumpSections.sort((left, right) => Number(left.pumpId) - Number(right.pumpId));
}

export function countTransactionsForReportPeriod(
  transactions: FuelTransaction[],
  reportMonth: number,
  reportYear: number,
) {
  const { start, end } = getReportWindow(reportMonth, reportYear);
  return transactions.filter(transaction => transaction.date >= start && transaction.date <= end).length;
}

export function getAvailableReportYears(transactions: FuelTransaction[], selectedYear: number) {
  const years = new Set<number>([selectedYear]);
  transactions.forEach(transaction => years.add(transaction.date.getFullYear()));
  return Array.from(years).sort((left, right) => left - right);
}

export function buildFuelReport({
  transactions,
  settings,
  reportMonth,
  reportYear,
}: {
  transactions: FuelTransaction[];
  settings: FuelSettings;
  reportMonth: number;
  reportYear: number;
}): FuelReport {
  const { start, end } = getReportWindow(reportMonth, reportYear);
  const filtered = transactions.filter(transaction => transaction.date >= start && transaction.date <= end);
  const groupedTransactions = new Map<string, FuelTransaction[]>();

  filtered.forEach(transaction => {
    const person = settings.peopleById[transaction.personShortname];
    if (!person) {
      throw new MissingPersonError(transaction.personShortname);
    }

    const vehicle = settings.vehiclesById[transaction.vehicleShortname];
    if (!vehicle) {
      throw new MissingVehicleError(transaction.vehicleShortname);
    }

    const pump = settings.pumpsById[transaction.pumpNumber];
    if (!pump) {
      throw new MissingPumpError(transaction.pumpNumber);
    }

    const groupId = person.group || vehicle.group;
    if (!groupId) {
      throw new MissingGroupAssignmentError(person.id, vehicle.id);
    }

    const mainGroup = settings.groupsById[groupId];
    if (!mainGroup) {
      throw new MissingGroupError(groupId);
    }

    const pumpGroupId = `pump-${transaction.pumpNumber}`;
    const pumpGroup = settings.groupsById[pumpGroupId];
    if (!pumpGroup) {
      throw new MissingGroupError(pumpGroupId);
    }

    const primaryBucket = groupedTransactions.get(groupId) || [];
    primaryBucket.push(transaction);
    groupedTransactions.set(groupId, primaryBucket);

    const pumpBucket = groupedTransactions.get(pumpGroupId) || [];
    pumpBucket.push(transaction);
    groupedTransactions.set(pumpGroupId, pumpBucket);
  });

  const sections: FuelReportGroupSection[] = [];
  for (const [groupId, groupTransactions] of groupedTransactions.entries()) {
    const group = settings.groupsById[groupId];
    if (!group) {
      throw new MissingGroupError(groupId);
    }

    sections.push({
      groupId,
      groupName: group.name,
      print: group.print,
      pumpSections: buildPumpSections(groupTransactions, settings),
    });
  }

  sections.sort((left, right) => left.groupName.localeCompare(right.groupName) || left.groupId.localeCompare(right.groupId));

  return {
    reportMonth,
    reportYear,
    fileStem: toFileStem(reportMonth, reportYear),
    start,
    end,
    startText: formatReportBoundary(start),
    endText: formatReportBoundary(end),
    fullSections: sections,
    printSections: sections.filter(section => section.print),
  };
}

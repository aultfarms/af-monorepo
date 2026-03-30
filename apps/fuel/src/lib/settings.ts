import * as google from '@aultfarms/google';
import { defaultGroups, defaultPeople, defaultPumps, defaultVehicles } from './defaultSettings';
import type {
  FuelSettings,
  FuelSettingsGroupRow,
  FuelSettingsPersonRow,
  FuelSettingsPumpRow,
  FuelSettingsVehicleRow,
} from './types';

export const SETTINGS_FOLDER_PATH = '/Ault Farms Shared/LiveData/Fuel';
export const SETTINGS_FILE_NAME = 'fuel_report_settings';
export const SETTINGS_FILE_PATH = `${SETTINGS_FOLDER_PATH}/${SETTINGS_FILE_NAME}`;

type WorksheetDefinition = {
  name: 'groups' | 'people' | 'vehicles' | 'pumps';
  header: string[];
  rows: string[][];
};

const WORKSHEET_DEFINITIONS: WorksheetDefinition[] = [
  {
    name: 'groups',
    header: ['id', 'name', 'print'],
    rows: defaultGroups.map(group => [group.id, group.name, group.print ? 'TRUE' : 'FALSE']),
  },
  {
    name: 'people',
    header: ['id', 'name', 'group'],
    rows: defaultPeople.map(person => [person.id, person.name, person.group || '']),
  },
  {
    name: 'vehicles',
    header: ['id', 'name', 'group'],
    rows: defaultVehicles.map(vehicle => [vehicle.id, vehicle.name, vehicle.group || '']),
  },
  {
    name: 'pumps',
    header: ['id', 'name'],
    rows: defaultPumps.map(pump => [pump.id, pump.name]),
  },
];

function normalizeId(value: unknown) {
  return `${value ?? ''}`.trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return `${value ?? ''}`.trim();
}

function isBlankRow(row: Record<string, unknown>) {
  return Object.values(row).every(value => normalizeText(value).length < 1);
}

function getFieldValue(row: Record<string, unknown>, fieldName: string) {
  const target = normalizeId(fieldName);
  for (const [key, value] of Object.entries(row)) {
    if (normalizeId(key) === target) {
      return value;
    }
  }
  return '';
}

function parseBooleanCell(value: unknown) {
  const normalized = normalizeId(value);
  return normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1';
}

function mapRowsById<T extends { id: string }>(rows: T[]) {
  return rows.reduce<Record<string, T>>((result, row) => {
    result[row.id] = row;
    return result;
  }, {});
}

async function ensureSettingsSpreadsheetId() {
  const folder = await google.drive.ensurePath({ path: SETTINGS_FOLDER_PATH });
  if (!folder?.id) {
    throw new Error(`Could not ensure the Google Drive folder at ${SETTINGS_FOLDER_PATH}.`);
  }

  const listing = await google.drive.ls({ id: folder.id });
  const existingFile = listing?.contents.find(file => file.name === SETTINGS_FILE_NAME);
  if (existingFile?.id) {
    return existingFile.id;
  }

  const created = await google.sheets.createSpreadsheet({
    parentid: folder.id,
    name: SETTINGS_FILE_NAME,
  });

  if (!created?.id) {
    throw new Error(`Could not create the settings spreadsheet at ${SETTINGS_FILE_PATH}.`);
  }

  return created.id;
}

async function ensureWorksheet(id: string, definition: WorksheetDefinition) {
  const spreadsheet = await google.sheets.getSpreadsheet({ id });
  const sheetNames = new Set(
    (spreadsheet?.sheets || [])
      .map(sheet => sheet.properties?.title)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
  );

  if (!sheetNames.has(definition.name)) {
    await google.sheets.createWorksheetInSpreadsheet({
      id,
      worksheetName: definition.name,
      header: definition.header,
    });
  }

  let existingSheet = await google.sheets.sheetToJson({
    id,
    worksheetName: definition.name,
  });

  if (!existingSheet || existingSheet.header.length < 1) {
    await google.sheets.putRow({
      id,
      worksheetName: definition.name,
      row: '1',
      cols: definition.header,
      rawVsUser: 'USER_ENTERED',
    });
    existingSheet = await google.sheets.sheetToJson({
      id,
      worksheetName: definition.name,
    });
  }

  const hasData = Boolean(
    existingSheet?.data.some(row => !isBlankRow(row)),
  );

  if (hasData) {
    return;
  }

  for (const [index, row] of definition.rows.entries()) {
    await google.sheets.putRow({
      id,
      worksheetName: definition.name,
      row: `${index + 2}`,
      cols: row,
      rawVsUser: 'USER_ENTERED',
    });
  }
}

function parseGroups(rows: Record<string, unknown>[]) {
  const groups: FuelSettingsGroupRow[] = [];

  rows.forEach(row => {
    if (isBlankRow(row)) {
      return;
    }

    const id = normalizeId(getFieldValue(row, 'id'));
    const name = normalizeText(getFieldValue(row, 'name'));
    if (!id || !name) {
      return;
    }

    groups.push({
      id,
      name,
      print: parseBooleanCell(getFieldValue(row, 'print')),
    });
  });

  return groups.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function parsePeople(rows: Record<string, unknown>[]) {
  const people: FuelSettingsPersonRow[] = [];

  rows.forEach(row => {
    if (isBlankRow(row)) {
      return;
    }

    const id = normalizeId(getFieldValue(row, 'id'));
    const name = normalizeText(getFieldValue(row, 'name'));
    if (!id || !name) {
      return;
    }

    people.push({
      id,
      name,
      group: normalizeId(getFieldValue(row, 'group')),
    });
  });

  return people.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function parseVehicles(rows: Record<string, unknown>[]) {
  const vehicles: FuelSettingsVehicleRow[] = [];

  rows.forEach(row => {
    if (isBlankRow(row)) {
      return;
    }

    const id = normalizeId(getFieldValue(row, 'id'));
    const name = normalizeText(getFieldValue(row, 'name'));
    if (!id || !name) {
      return;
    }

    vehicles.push({
      id,
      name,
      group: normalizeId(getFieldValue(row, 'group')),
    });
  });

  return vehicles.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function parsePumps(rows: Record<string, unknown>[]) {
  const pumps: FuelSettingsPumpRow[] = [];

  rows.forEach(row => {
    if (isBlankRow(row)) {
      return;
    }

    const id = normalizeId(getFieldValue(row, 'id'));
    const name = normalizeText(getFieldValue(row, 'name'));
    if (!id || !name) {
      return;
    }

    pumps.push({
      id,
      name,
    });
  });

  return pumps.sort((left, right) => Number(left.id) - Number(right.id));
}

export async function loadFuelSettings(): Promise<FuelSettings> {
  await google.auth.authorize();
  const spreadsheetId = await ensureSettingsSpreadsheetId();

  for (const definition of WORKSHEET_DEFINITIONS) {
    await ensureWorksheet(spreadsheetId, definition);
  }
  const workbook = await google.sheets.spreadsheetToJson({ id: spreadsheetId });
  if (!workbook) {
    throw new Error('Could not load the fuel settings spreadsheet from Google.');
  }

  const groups = parseGroups(workbook.groups?.data || []);
  const people = parsePeople(workbook.people?.data || []);
  const vehicles = parseVehicles(workbook.vehicles?.data || []);
  const pumps = parsePumps(workbook.pumps?.data || []);

  return {
    spreadsheetId,
    spreadsheetPath: SETTINGS_FILE_PATH,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    groups,
    groupsById: mapRowsById(groups),
    people,
    peopleById: mapRowsById(people),
    vehicles,
    vehiclesById: mapRowsById(vehicles),
    pumps,
    pumpsById: mapRowsById(pumps),
  };
}

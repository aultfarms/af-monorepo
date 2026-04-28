import type { Driver, Field, LoadsRecord, Source } from './types.js';

export type FieldSheetRow = {
  id: string;
  name: string;
  acreage: number;
  boundary: string;
};

export type SourceSheetRow = {
  id: string;
  name: string;
  type: Source['type'];
  acPerLoad: number;
};

export type DriverSheetRow = {
  id: string;
  name: string;
};

export type LoadSheetRow = {
  id: string;
  date: string;
  field: string;
  source: string;
  loads: number;
  driver: string;
  geojson: string;
};

export function fieldToSheetRow(field: Field): FieldSheetRow {
  return {
    id: field.id || '',
    name: field.name,
    acreage: field.acreage,
    boundary: JSON.stringify(field.boundary),
  };
}

export function sourceToSheetRow(source: Source): SourceSheetRow {
  return {
    id: source.id || '',
    name: source.name,
    type: source.type,
    acPerLoad: source.acPerLoad,
  };
}

export function driverToSheetRow(driver: Driver): DriverSheetRow {
  return {
    id: driver.id || '',
    name: driver.name,
  };
}

export function loadToSheetRow(load: LoadsRecord): LoadSheetRow {
  return {
    id: load.id || '',
    date: load.date,
    field: load.field,
    source: load.source,
    loads: load.loads,
    driver: load.driver,
    geojson: JSON.stringify(load.geojson),
  };
}

import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';

export type GPS = { lat: number; lon: number };

export function assertGPS(o: unknown): asserts o is GPS {
  if (!o || typeof o !== 'object') throw new Error('Expected GPS to be a truthy object');
  const gps = o as GPS;
  if (typeof gps.lat !== 'number') throw new Error('Expected GPS.lat to be a number');
  if (typeof gps.lon !== 'number') throw new Error('Expected GPS.lon to be a number');
}

export type AuditFields = {
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type LoadsRecord = AuditFields & {
  id?: string;
  date: string;
  field: string;
  source: string;
  loads: number;
  driver: string;
  geojson: FeatureCollection<Point>;
};

export function assertLoadsRecord(o: unknown): asserts o is LoadsRecord {
  if (!o || typeof o !== 'object') throw new Error('Expected LoadsRecord to be a truthy object');
  const record = o as LoadsRecord;
  if (typeof record.id !== 'undefined' && typeof record.id !== 'string') throw new Error('Expected LoadsRecord.id to be a string if it exists');
  if (typeof record.date !== 'string') throw new Error(`Expected LoadsRecord.date (${String(record.date)}) to be a string`);
  if (typeof record.field !== 'string') throw new Error('Expected LoadsRecord.field to be a string');
  if (typeof record.source !== 'string') throw new Error('Expected LoadsRecord.source to be a string');
  if (typeof record.loads !== 'number') throw new Error('Expected LoadsRecord.loads to be a number');
  if (typeof record.driver !== 'string') throw new Error('Expected LoadsRecord.driver to be a string');
  if (typeof record.geojson !== 'object') throw new Error('Expected LoadsRecord.geojson to be a GeoJSON object');
  if (record.geojson.type !== 'FeatureCollection') throw new Error('Expected LoadsRecord.geojson to be a FeatureCollection');
  if (!Array.isArray(record.geojson.features)) throw new Error('Expected LoadsRecord.geojson.features to be an array');
  for (const feature of record.geojson.features) {
    if (feature.type !== 'Feature') throw new Error('Expected LoadsRecord.geojson features to be Feature objects');
    if (feature.geometry.type !== 'Point') throw new Error('Expected LoadsRecord.geojson features to be Points');
    if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length !== 2) {
      throw new Error('Expected LoadsRecord.geojson point coordinates to have length 2');
    }
    if (typeof feature.geometry.coordinates[0] !== 'number') throw new Error('Expected LoadsRecord.geojson longitude to be a number');
    if (typeof feature.geometry.coordinates[1] !== 'number') throw new Error('Expected LoadsRecord.geojson latitude to be a number');
  }
}

export function assertLoadsRecords(o: unknown): asserts o is LoadsRecord[] {
  if (!o || !Array.isArray(o)) throw new Error('Expected LoadsRecords to be a truthy array');
  for (const [index, record] of o.entries()) {
    try {
      assertLoadsRecord(record);
    } catch (error) {
      throw new Error(`Expected LoadsRecords[${index}] to be a LoadsRecord: ${(error as Error).message}`);
    }
  }
}

export type LoadsRecordGeoJSONProps = Omit<LoadsRecord, 'geojson'>;
export type LoadsRecordGeoJSON = FeatureCollection<Point, LoadsRecordGeoJSONProps>;

export type Field = AuditFields & {
  id?: string;
  name: string;
  boundary: Feature<Polygon | MultiPolygon>;
};

export function assertField(o: unknown): asserts o is Field {
  if (!o || typeof o !== 'object') throw new Error('Expected Field to be a truthy object');
  const field = o as Field;
  if (typeof field.id !== 'undefined' && typeof field.id !== 'string') throw new Error('Expected Field.id to be a string if it exists');
  if (typeof field.name !== 'string') throw new Error('Expected Field.name to be a string');
  if (typeof field.boundary !== 'object') throw new Error('Expected Field.boundary to be a GeoJSON object');
  if (field.boundary.type !== 'Feature') throw new Error('Expected Field.boundary to be a Feature');
  if (field.boundary.geometry.type !== 'Polygon' && field.boundary.geometry.type !== 'MultiPolygon') {
    throw new Error('Expected Field.boundary to be a Polygon or MultiPolygon');
  }
}

export function assertFields(o: unknown): asserts o is Field[] {
  if (!o || !Array.isArray(o)) throw new Error('Expected Fields to be a truthy array');
  for (const field of o) assertField(field);
}

export type FieldGeoJSONProps = {
  name: string;
};

export type FieldGeoJSON = FeatureCollection<Polygon | MultiPolygon, FieldGeoJSONProps>;

export type Source = AuditFields & {
  id?: string;
  name: string;
  type: 'solid' | 'liquid';
  acPerLoad: number;
};

export function assertSource(o: unknown): asserts o is Source {
  if (!o || typeof o !== 'object') throw new Error('Expected Source to be a truthy object');
  const source = o as Source;
  if (typeof source.id !== 'undefined' && typeof source.id !== 'string') throw new Error('Expected Source.id to be a string if it exists');
  if (typeof source.name !== 'string') throw new Error('Expected Source.name to be a string');
  if (source.type !== 'solid' && source.type !== 'liquid') throw new Error('Expected Source.type to be "solid" or "liquid"');
  if (typeof source.acPerLoad !== 'number') throw new Error('Expected Source.acPerLoad to be a number');
}

export function assertSources(o: unknown): asserts o is Source[] {
  if (!o || !Array.isArray(o)) throw new Error('Expected Sources to be a truthy array');
  for (const source of o) assertSource(source);
}

export type Driver = AuditFields & {
  id?: string;
  name: string;
};

export function assertDriver(o: unknown): asserts o is Driver {
  if (!o || typeof o !== 'object') throw new Error('Expected Driver to be a truthy object');
  const driver = o as Driver;
  if (typeof driver.id !== 'undefined' && typeof driver.id !== 'string') throw new Error('Expected Driver.id to be a string if it exists');
  if (typeof driver.name !== 'string') throw new Error('Expected Driver.name to be a string');
}

export function assertDrivers(o: unknown): asserts o is Driver[] {
  if (!o || !Array.isArray(o)) throw new Error('Expected Drivers to be a truthy array');
  for (const driver of o) assertDriver(driver);
}

export type AccessRecord = AuditFields & {
  email: string;
  enabled: boolean;
  admin: boolean;
  displayName?: string;
};

export type ManureAppData = {
  year: number;
  fields: Field[];
  sources: Source[];
  drivers: Driver[];
  loads: LoadsRecord[];
  previousLoads: LoadsRecord[];
};

export function emptyLoadRecord(date = new Date().toISOString().split('T')[0] || ''): LoadsRecord {
  return {
    date,
    field: '',
    source: '',
    loads: 0,
    driver: '',
    geojson: { type: 'FeatureCollection', features: [] },
  };
}

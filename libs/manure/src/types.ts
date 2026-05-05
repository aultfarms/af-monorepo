import area from '@turf/area';
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from 'geojson';

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
  acreage: number;
  responsibleParty: string;
  boundary: Feature<Polygon | MultiPolygon>;
  defaultHeadingDegrees?: number;
};

function roundAcres(value: number): number {
  return Math.round(value * 100) / 100;
}

export function acreageFromFieldName(name: string): number | null {
  const match = name.match(/\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const acreage = Number.parseFloat(match[0]);
  if (!Number.isFinite(acreage) || acreage <= 0) {
    return null;
  }

  return roundAcres(acreage);
}

export function acreageFromFieldBoundary(boundary: Field['boundary']): number {
  return roundAcres(area(boundary) / 4046.8564224);
}

export function nominalFieldAcreage(name: string, boundary: Field['boundary']): number {
  return acreageFromFieldName(name) ?? acreageFromFieldBoundary(boundary);
}

export function assertField(o: unknown): asserts o is Field {
  if (!o || typeof o !== 'object') throw new Error('Expected Field to be a truthy object');
  const field = o as Field;
  if (typeof field.id !== 'undefined' && typeof field.id !== 'string') throw new Error('Expected Field.id to be a string if it exists');
  if (typeof field.name !== 'string') throw new Error('Expected Field.name to be a string');
  if (typeof field.acreage !== 'number' || !Number.isFinite(field.acreage)) throw new Error('Expected Field.acreage to be a finite number');
  if (typeof field.responsibleParty !== 'string') throw new Error('Expected Field.responsibleParty to be a string');
  if (typeof field.boundary !== 'object') throw new Error('Expected Field.boundary to be a GeoJSON object');
  if (field.boundary.type !== 'Feature') throw new Error('Expected Field.boundary to be a Feature');
  if (field.boundary.geometry.type !== 'Polygon' && field.boundary.geometry.type !== 'MultiPolygon') {
    throw new Error('Expected Field.boundary to be a Polygon or MultiPolygon');
  }
  if (typeof field.defaultHeadingDegrees !== 'undefined' && (!Number.isFinite(field.defaultHeadingDegrees))) {
    throw new Error('Expected Field.defaultHeadingDegrees to be a finite number if it exists');
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
  spreadWidthFeet?: number;
  defaultLoadLengthFeet?: number;
};

export function assertSource(o: unknown): asserts o is Source {
  if (!o || typeof o !== 'object') throw new Error('Expected Source to be a truthy object');
  const source = o as Source;
  if (typeof source.id !== 'undefined' && typeof source.id !== 'string') throw new Error('Expected Source.id to be a string if it exists');
  if (typeof source.name !== 'string') throw new Error('Expected Source.name to be a string');
  if (source.type !== 'solid' && source.type !== 'liquid') throw new Error('Expected Source.type to be "solid" or "liquid"');
  if (typeof source.acPerLoad !== 'number') throw new Error('Expected Source.acPerLoad to be a number');
  if (typeof source.spreadWidthFeet !== 'undefined' && (!Number.isFinite(source.spreadWidthFeet) || source.spreadWidthFeet <= 0)) {
    throw new Error('Expected Source.spreadWidthFeet to be a positive finite number if it exists');
  }
  if (typeof source.defaultLoadLengthFeet !== 'undefined' && (!Number.isFinite(source.defaultLoadLengthFeet) || source.defaultLoadLengthFeet <= 0)) {
    throw new Error('Expected Source.defaultLoadLengthFeet to be a positive finite number if it exists');
  }
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

export type SpreadRegionMode = 'load' | 'polygon';

export type SpreadRegion = AuditFields & {
  id?: string;
  field: string;
  mode: SpreadRegionMode;
  polygon: Feature<Polygon | MultiPolygon>;
  centerline?: Feature<LineString>;
  headingDegrees?: number;
  spreadWidthFeet?: number;
  dateStart?: string;
  dateEnd?: string;
  supersededByRegionId?: string;
};

export function assertSpreadRegion(o: unknown): asserts o is SpreadRegion {
  if (!o || typeof o !== 'object') throw new Error('Expected SpreadRegion to be a truthy object');
  const region = o as SpreadRegion;
  if (typeof region.id !== 'undefined' && typeof region.id !== 'string') throw new Error('Expected SpreadRegion.id to be a string if it exists');
  if (typeof region.field !== 'string') throw new Error('Expected SpreadRegion.field to be a string');
  if (region.mode !== 'load' && region.mode !== 'polygon') throw new Error('Expected SpreadRegion.mode to be \"load\" or \"polygon\"');
  if (!region.polygon || typeof region.polygon !== 'object') throw new Error('Expected SpreadRegion.polygon to be a GeoJSON feature');
  if (region.polygon.type !== 'Feature') throw new Error('Expected SpreadRegion.polygon to be a Feature');
  if (region.polygon.geometry.type !== 'Polygon' && region.polygon.geometry.type !== 'MultiPolygon') {
    throw new Error('Expected SpreadRegion.polygon geometry to be a Polygon or MultiPolygon');
  }
  if (typeof region.centerline !== 'undefined') {
    if (region.centerline.type !== 'Feature') throw new Error('Expected SpreadRegion.centerline to be a Feature if it exists');
    if (region.centerline.geometry.type !== 'LineString') throw new Error('Expected SpreadRegion.centerline geometry to be a LineString if it exists');
  }
  if (typeof region.headingDegrees !== 'undefined' && !Number.isFinite(region.headingDegrees)) {
    throw new Error('Expected SpreadRegion.headingDegrees to be a finite number if it exists');
  }
  if (typeof region.spreadWidthFeet !== 'undefined' && (!Number.isFinite(region.spreadWidthFeet) || region.spreadWidthFeet <= 0)) {
    throw new Error('Expected SpreadRegion.spreadWidthFeet to be a positive finite number if it exists');
  }
  if (typeof region.dateStart !== 'undefined' && typeof region.dateStart !== 'string') throw new Error('Expected SpreadRegion.dateStart to be a string if it exists');
  if (typeof region.dateEnd !== 'undefined' && typeof region.dateEnd !== 'string') throw new Error('Expected SpreadRegion.dateEnd to be a string if it exists');
  if (typeof region.supersededByRegionId !== 'undefined' && typeof region.supersededByRegionId !== 'string') {
    throw new Error('Expected SpreadRegion.supersededByRegionId to be a string if it exists');
  }
}

export function assertSpreadRegions(o: unknown): asserts o is SpreadRegion[] {
  if (!o || !Array.isArray(o)) throw new Error('Expected SpreadRegions to be a truthy array');
  for (const [index, region] of o.entries()) {
    try {
      assertSpreadRegion(region);
    } catch (error) {
      throw new Error(`Expected SpreadRegions[${index}] to be a SpreadRegion: ${(error as Error).message}`);
    }
  }
}

export type SpreadRegionAssignment = AuditFields & {
  id?: string;
  regionId: string;
  loadGroupKey: string;
  date: string;
  field: string;
  source: string;
  loadCount: number;
};

export function assertSpreadRegionAssignment(o: unknown): asserts o is SpreadRegionAssignment {
  if (!o || typeof o !== 'object') throw new Error('Expected SpreadRegionAssignment to be a truthy object');
  const assignment = o as SpreadRegionAssignment;
  if (typeof assignment.id !== 'undefined' && typeof assignment.id !== 'string') throw new Error('Expected SpreadRegionAssignment.id to be a string if it exists');
  if (typeof assignment.regionId !== 'string') throw new Error('Expected SpreadRegionAssignment.regionId to be a string');
  if (typeof assignment.loadGroupKey !== 'string') throw new Error('Expected SpreadRegionAssignment.loadGroupKey to be a string');
  if (typeof assignment.date !== 'string') throw new Error('Expected SpreadRegionAssignment.date to be a string');
  if (typeof assignment.field !== 'string') throw new Error('Expected SpreadRegionAssignment.field to be a string');
  if (typeof assignment.source !== 'string') throw new Error('Expected SpreadRegionAssignment.source to be a string');
  if (!Number.isFinite(assignment.loadCount) || assignment.loadCount <= 0) {
    throw new Error('Expected SpreadRegionAssignment.loadCount to be a positive finite number');
  }
}

export function assertSpreadRegionAssignments(o: unknown): asserts o is SpreadRegionAssignment[] {
  if (!o || !Array.isArray(o)) throw new Error('Expected SpreadRegionAssignments to be a truthy array');
  for (const [index, assignment] of o.entries()) {
    try {
      assertSpreadRegionAssignment(assignment);
    } catch (error) {
      throw new Error(`Expected SpreadRegionAssignments[${index}] to be a SpreadRegionAssignment: ${(error as Error).message}`);
    }
  }
}

function normalizeGroupKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'blank';
}

export function createLoadGroupKey(load: Pick<LoadsRecord, 'date' | 'field' | 'source'>): string {
  return [
    load.date,
    normalizeGroupKeyPart(load.field),
    normalizeGroupKeyPart(load.source),
  ].join('__');
}

export type ManureAppData = {
  year: number;
  fields: Field[];
  sources: Source[];
  drivers: Driver[];
  loads: LoadsRecord[];
  regions: SpreadRegion[];
  regionAssignments: SpreadRegionAssignment[];
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

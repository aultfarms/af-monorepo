import debug from 'debug';
import { getBrowserFirebase } from '@aultfarms/firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  setDoc,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  createLoadGroupKey,
  nominalFieldAcreage,
  type AccessRecord,
  type Driver,
  type Field,
  type LoadsRecord,
  type ManureAppData,
  type Source,
  type SpreadRegion,
  type SpreadRegionAssignment,
} from './types.js';

const info = debug('af/manure-lib:info');
const warn = debug('af/manure-lib:warn');

const MANURE_YEARS_COLLECTION = 'manureYears';
const MANURE_ACCESS_COLLECTION = 'manureAccess';
const METADATA_COLLECTIONS = [ 'fields', 'sources', 'drivers' ] as const;
const SPREAD_REGIONS_COLLECTION = 'regions';
const SPREAD_REGION_ASSIGNMENTS_COLLECTION = 'regionAssignments';
const DEFAULT_SOURCE_SPREAD_WIDTH_FEET = 40;
const DEFAULT_SOURCE_LOAD_LENGTH_FEET = 500;
const CURRENT_MANURE_SCHEMA_VERSION = 2;

type MetadataCollectionName = typeof METADATA_COLLECTIONS[number];
type StoredFieldDocument = Omit<Field, 'id' | 'boundary'> & {
  boundary: string | Field['boundary'];
};
type StoredSpreadRegionDocument = Omit<SpreadRegion, 'id' | 'polygon' | 'centerline'> & {
  polygon: string | SpreadRegion['polygon'];
  centerline?: string | SpreadRegion['centerline'];
};

function firestore() {
  return getBrowserFirebase().firestore;
}

function currentAuthSummary() {
  const user = getBrowserFirebase().auth.currentUser;
  if (!user) {
    return null;
  }

  return {
    uid: user.uid,
    email: user.email || '',
    emailVerified: user.emailVerified,
    providers: user.providerData.map((provider) => ({
      providerId: provider.providerId,
      email: provider.email || '',
      displayName: provider.displayName || '',
    })),
  };
}

async function logCurrentAuthTokenSummary(context: string): Promise<void> {
  const user = getBrowserFirebase().auth.currentUser;
  if (!user) {
    info('%s - no Firebase Auth currentUser available during manure repository call', context);
    return;
  }

  try {
    const tokenResult = await user.getIdTokenResult();
    info(
      '%s - uid=%s email=%s verified=%s tokenEmail=%s tokenEmailVerified=%s signInProvider=%s authTime=%s issuedAt=%s expiration=%s',
      context,
      user.uid,
      user.email || '',
      user.emailVerified,
      typeof tokenResult.claims.email === 'string' ? tokenResult.claims.email : '',
      tokenResult.claims.email_verified === true,
      tokenResult.signInProvider || '',
      tokenResult.authTime,
      tokenResult.issuedAtTime,
      tokenResult.expirationTime,
    );
  } catch (error) {
    warn(
      '%s - failed to inspect Firebase token for uid=%s email=%s. Error=%O',
      context,
      user.uid,
      user.email || '',
      error,
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

function makeEntityId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeKeyPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return normalized || 'blank';
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue !== 'undefined'),
  ) as T;
}

function isFieldBoundary(value: unknown): value is Field['boundary'] {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const boundary = value as Field['boundary'];
  if (boundary.type !== 'Feature') {
    return false;
  }

  if (!boundary.geometry || typeof boundary.geometry !== 'object') {
    return false;
  }

  return boundary.geometry.type === 'Polygon' || boundary.geometry.type === 'MultiPolygon';
}

function normalizeFieldBoundary(boundary: Field['boundary']): Field['boundary'] {
  return {
    type: 'Feature',
    properties: null,
    geometry: boundary.geometry,
  };
}

function serializeFieldBoundary(boundary: Field['boundary']): string {
  return JSON.stringify(normalizeFieldBoundary(boundary));
}

function parseFieldBoundary(value: unknown, path: string): Field['boundary'] {
  let parsedValue = value;

  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value);
    } catch (error) {
      throw new Error(`Field boundary at ${path} is not valid JSON: ${(error as Error).message}`);
    }
  }

  if (!isFieldBoundary(parsedValue)) {
    throw new Error(`Field boundary at ${path} is not valid GeoJSON`);
  }

  return normalizeFieldBoundary(parsedValue);
}

function isPolygonFeature(value: unknown): value is SpreadRegion['polygon'] {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const feature = value as SpreadRegion['polygon'];
  if (feature.type !== 'Feature') {
    return false;
  }

  if (!feature.geometry || typeof feature.geometry !== 'object') {
    return false;
  }

  return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon';
}

function normalizePolygonFeature(feature: SpreadRegion['polygon']): SpreadRegion['polygon'] {
  return {
    type: 'Feature',
    properties: null,
    geometry: feature.geometry,
  };
}

function serializePolygonFeature(feature: SpreadRegion['polygon']): string {
  return JSON.stringify(normalizePolygonFeature(feature));
}

function parsePolygonFeature(value: unknown, path: string): SpreadRegion['polygon'] {
  let parsedValue = value;

  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value);
    } catch (error) {
      throw new Error(`Polygon feature at ${path} is not valid JSON: ${(error as Error).message}`);
    }
  }

  if (!isPolygonFeature(parsedValue)) {
    throw new Error(`Polygon feature at ${path} is not valid GeoJSON`);
  }

  return normalizePolygonFeature(parsedValue);
}

function isLineFeature(value: unknown): value is NonNullable<SpreadRegion['centerline']> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const feature = value as NonNullable<SpreadRegion['centerline']>;
  if (feature.type !== 'Feature') {
    return false;
  }

  if (!feature.geometry || typeof feature.geometry !== 'object') {
    return false;
  }

  return feature.geometry.type === 'LineString';
}

function normalizeLineFeature(feature: NonNullable<SpreadRegion['centerline']>): NonNullable<SpreadRegion['centerline']> {
  return {
    type: 'Feature',
    properties: null,
    geometry: feature.geometry,
  };
}

function serializeLineFeature(feature: NonNullable<SpreadRegion['centerline']>): string {
  return JSON.stringify(normalizeLineFeature(feature));
}

function parseLineFeature(value: unknown, path: string): NonNullable<SpreadRegion['centerline']> {
  let parsedValue = value;

  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value);
    } catch (error) {
      throw new Error(`Line feature at ${path} is not valid JSON: ${(error as Error).message}`);
    }
  }

  if (!isLineFeature(parsedValue)) {
    throw new Error(`Line feature at ${path} is not valid GeoJSON`);
  }

  return normalizeLineFeature(parsedValue);
}

function yearDocRef(year: number) {
  return doc(firestore(), MANURE_YEARS_COLLECTION, String(year));
}

function subcollectionRef(year: number, name: string) {
  return collection(yearDocRef(year), name);
}

function metadataCollectionRef(year: number, name: MetadataCollectionName) {
  return subcollectionRef(year, name);
}

function spreadRegionsCollectionRef(year: number) {
  return subcollectionRef(year, SPREAD_REGIONS_COLLECTION);
}

function spreadRegionAssignmentsCollectionRef(year: number) {
  return subcollectionRef(year, SPREAD_REGION_ASSIGNMENTS_COLLECTION);
}

function accessDocRef(email: string) {
  return doc(firestore(), MANURE_ACCESS_COLLECTION, emailKey(email));
}

function accessCollectionRef() {
  return collection(firestore(), MANURE_ACCESS_COLLECTION);
}

function isOfflineFirestoreError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
  const message = typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message.toLowerCase()
    : '';

  return code === 'unavailable' || message.includes('offline');
}

async function getDocWithOfflineFallback(
  reference: DocumentReference<DocumentData>,
  offlineCacheMissMessage?: string,
) {
  info('Reading Firestore document from server path=%s', reference.path);
  try {
    return await getDoc(reference);
  } catch (error) {
    warn(
      'Firestore server document read failed path=%s code=%s message=%s error=%O',
      reference.path,
      (error as { code?: string }).code || '',
      (error as Error).message || '',
      error,
    );
    if (!isOfflineFirestoreError(error)) {
      throw error;
    }
    info('Falling back to cached Firestore document path=%s', reference.path);

    try {
      const cachedSnapshot = await getDocFromCache(reference);
      info('Loaded Firestore document from cache path=%s exists=%s', reference.path, cachedSnapshot.exists());
      return cachedSnapshot;
    } catch (cacheError) {
      warn(
        'Firestore cached document read failed path=%s code=%s message=%s error=%O',
        reference.path,
        (cacheError as { code?: string }).code || '',
        (cacheError as Error).message || '',
        cacheError,
      );
      if (offlineCacheMissMessage && isOfflineFirestoreError(cacheError)) {
        throw new Error(offlineCacheMissMessage);
      }

      throw cacheError;
    }
  }
}

async function getDocsWithOfflineFallback(
  queryRef: Query<DocumentData>,
  queryDescription: string,
  offlineCacheMissMessage?: string,
) {
  info('Reading Firestore query from server target=%s', queryDescription);
  try {
    return await getDocs(queryRef);
  } catch (error) {
    warn(
      'Firestore server query failed target=%s code=%s message=%s error=%O',
      queryDescription,
      (error as { code?: string }).code || '',
      (error as Error).message || '',
      error,
    );
    if (!isOfflineFirestoreError(error)) {
      throw error;
    }
    info('Falling back to cached Firestore query target=%s', queryDescription);

    try {
      const cachedSnapshot = await getDocsFromCache(queryRef);
      info('Loaded Firestore query from cache target=%s count=%d', queryDescription, cachedSnapshot.size);
      return cachedSnapshot;
    } catch (cacheError) {
      warn(
        'Firestore cached query failed target=%s code=%s message=%s error=%O',
        queryDescription,
        (cacheError as { code?: string }).code || '',
        (cacheError as Error).message || '',
        cacheError,
      );
      if (offlineCacheMissMessage && isOfflineFirestoreError(cacheError)) {
        throw new Error(offlineCacheMissMessage);
      }

      throw cacheError;
    }
  }
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [ ...items ].sort((left, right) => left.name.localeCompare(right.name));
}

function sortLoads(loads: LoadsRecord[]): LoadsRecord[] {
  return [ ...loads ].sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) return byDate;
    const byField = left.field.localeCompare(right.field);
    if (byField !== 0) return byField;
    const bySource = left.source.localeCompare(right.source);
    if (bySource !== 0) return bySource;
    return left.driver.localeCompare(right.driver);
  });
}

function toField(snapshot: QueryDocumentSnapshot<DocumentData>): Field {
  const data = snapshot.data() as StoredFieldDocument;
  const boundary = parseFieldBoundary(data.boundary, snapshot.ref.path);
  return {
    id: snapshot.id,
    ...data,
    acreage: nominalFieldAcreage(data.name, boundary),
    boundary,
  };
}

function toSource(snapshot: QueryDocumentSnapshot<DocumentData>): Source {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<Source, 'id'>),
  };
}

function toDriver(snapshot: QueryDocumentSnapshot<DocumentData>): Driver {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<Driver, 'id'>),
  };
}

function toLoad(snapshot: QueryDocumentSnapshot<DocumentData>): LoadsRecord {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<LoadsRecord, 'id'>),
  };
}

function toSpreadRegion(snapshot: QueryDocumentSnapshot<DocumentData>): SpreadRegion {
  const data = snapshot.data() as StoredSpreadRegionDocument;
  return {
    id: snapshot.id,
    ...data,
    polygon: parsePolygonFeature(data.polygon, `${snapshot.ref.path}.polygon`),
    centerline: typeof data.centerline === 'undefined'
      ? undefined
      : parseLineFeature(data.centerline, `${snapshot.ref.path}.centerline`),
  };
}

function toSpreadRegionAssignment(snapshot: QueryDocumentSnapshot<DocumentData>): SpreadRegionAssignment {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<SpreadRegionAssignment, 'id'>),
  };
}

function toAccessRecord(snapshot: QueryDocumentSnapshot<DocumentData>): AccessRecord {
  return {
    email: snapshot.id,
    ...(snapshot.data() as Omit<AccessRecord, 'email'>),
  };
}

function sortAccessRecords(records: AccessRecord[]): AccessRecord[] {
  return [ ...records ].sort((left, right) => left.email.localeCompare(right.email));
}

function sortSpreadRegions(regions: SpreadRegion[]): SpreadRegion[] {
  return [ ...regions ].sort((left, right) => {
    const byField = left.field.localeCompare(right.field);
    if (byField !== 0) return byField;
    const byStart = (left.dateStart || '').localeCompare(right.dateStart || '');
    if (byStart !== 0) return byStart;
    const byEnd = (left.dateEnd || '').localeCompare(right.dateEnd || '');
    if (byEnd !== 0) return byEnd;
    return (left.id || '').localeCompare(right.id || '');
  });
}

function sortSpreadRegionAssignments(assignments: SpreadRegionAssignment[]): SpreadRegionAssignment[] {
  return [ ...assignments ].sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) return byDate;
    const byField = left.field.localeCompare(right.field);
    if (byField !== 0) return byField;
    const bySource = left.source.localeCompare(right.source);
    if (bySource !== 0) return bySource;
    const byRegion = left.regionId.localeCompare(right.regionId);
    if (byRegion !== 0) return byRegion;
    return (left.id || '').localeCompare(right.id || '');
  });
}

function normalizeSourceDefaults(source: Source): Source {
  return {
    ...source,
    spreadWidthFeet: source.spreadWidthFeet ?? DEFAULT_SOURCE_SPREAD_WIDTH_FEET,
    defaultLoadLengthFeet: source.defaultLoadLengthFeet ?? DEFAULT_SOURCE_LOAD_LENGTH_FEET,
  };
}

function normalizeSourcesDefaults(sources: Source[]): Source[] {
  return sources.map(normalizeSourceDefaults);
}

function currentActorEmail(fallback = 'migration'): string {
  const email = getBrowserFirebase().auth.currentUser?.email?.trim().toLowerCase();
  return email || fallback;
}

async function ensureYearDocument(year: number): Promise<void> {
  const yearRef = yearDocRef(year);
  const snapshot = await getDocWithOfflineFallback(
    yearRef,
    `Unable to prepare manure data for ${year} while offline. Connect once online so this year's data can be cached, then retry.`,
  );
  if (snapshot.exists()) {
    info('Year document already exists for year=%d', year);
    return;
  }
  info('Creating missing year document for year=%d', year);

  await setDoc(yearRef, {
    year,
    createdAt: nowIso(),
    schemaVersion: CURRENT_MANURE_SCHEMA_VERSION,
  });
}

async function copyMetadataCollectionFromPreviousYear(year: number, name: MetadataCollectionName): Promise<void> {
  const currentSnapshot = await getDocsWithOfflineFallback(
    metadataCollectionRef(year, name),
    `${MANURE_YEARS_COLLECTION}/${year}/${name}`,
    `Unable to prepare manure metadata for ${year} while offline. Connect once online so it can be cached, then retry.`,
  );
  if (!currentSnapshot.empty) {
    info('Metadata collection already populated for year=%d collection=%s count=%d', year, name, currentSnapshot.size);
    return;
  }
  const previousSnapshot = await getDocsWithOfflineFallback(
    metadataCollectionRef(year - 1, name),
    `${MANURE_YEARS_COLLECTION}/${year - 1}/${name}`,
    `Unable to prepare manure metadata for ${year} while offline. Connect once online so it can be cached, then retry.`,
  );
  if (previousSnapshot.empty) {
    info('No previous-year metadata found to copy for year=%d collection=%s', year, name);
    return;
  }

  // A new year starts by inheriting the previous year's lookup data when available.
  info('Copying previous-year metadata into year=%d collection=%s count=%d', year, name, previousSnapshot.size);
  const batch = writeBatch(firestore());
  const copiedAt = nowIso();
  for (const docSnapshot of previousSnapshot.docs) {
    batch.set(doc(metadataCollectionRef(year, name), docSnapshot.id), stripUndefined({
      ...docSnapshot.data(),
      updatedAt: copiedAt,
    }));
  }
  await batch.commit();
}

async function ensureYearBootstrap(year: number): Promise<void> {
  await ensureYearDocument(year);
  await Promise.all(METADATA_COLLECTIONS.map(name => copyMetadataCollectionFromPreviousYear(year, name)));
}

async function migrateYearSchemaIfNeeded(
  year: number,
  data: Omit<ManureAppData, 'previousLoads'>,
  currentSchemaVersion: number,
): Promise<void> {
  const normalizedSources = normalizeSourcesDefaults(data.sources);
  const sourcesNeedMigration = normalizedSources.some((source, index) => (
    source.spreadWidthFeet !== data.sources[index]?.spreadWidthFeet
    || source.defaultLoadLengthFeet !== data.sources[index]?.defaultLoadLengthFeet
  ));
  const fieldsNeedMigration = data.fields.some(field => typeof field.defaultHeadingDegrees === 'undefined');
  const schemaNeedsMigration = currentSchemaVersion < CURRENT_MANURE_SCHEMA_VERSION;

  if (!sourcesNeedMigration && !fieldsNeedMigration && !schemaNeedsMigration) {
    return;
  }

  info(
    'Migrating manure schema year=%d fromVersion=%d sourcesNeedMigration=%s fieldsNeedMigration=%s',
    year,
    currentSchemaVersion,
    sourcesNeedMigration,
    fieldsNeedMigration,
  );

  const actorEmail = currentActorEmail();
  const timestamp = nowIso();
  const batch = writeBatch(firestore());

  if (fieldsNeedMigration) {
    for (const field of data.fields) {
      batch.set(doc(metadataCollectionRef(year, 'fields'), field.id!), stripUndefined({
        name: field.name,
        acreage: field.acreage,
        boundary: serializeFieldBoundary(field.boundary),
        defaultHeadingDegrees: field.defaultHeadingDegrees,
        createdAt: field.createdAt || timestamp,
        updatedAt: timestamp,
        updatedBy: actorEmail,
      }));
    }
  }

  if (sourcesNeedMigration) {
    for (const source of normalizedSources) {
      batch.set(doc(metadataCollectionRef(year, 'sources'), source.id!), stripUndefined({
        name: source.name,
        type: source.type,
        acPerLoad: source.acPerLoad,
        spreadWidthFeet: source.spreadWidthFeet,
        defaultLoadLengthFeet: source.defaultLoadLengthFeet,
        createdAt: source.createdAt || timestamp,
        updatedAt: timestamp,
        updatedBy: actorEmail,
      }));
    }
    data.sources = sortByName(normalizedSources);
  }

  if (schemaNeedsMigration) {
    batch.set(yearDocRef(year), {
      year,
      schemaVersion: CURRENT_MANURE_SCHEMA_VERSION,
      migratedAt: timestamp,
      migratedBy: actorEmail,
      updatedAt: timestamp,
    }, { merge: true });
  }

  await batch.commit();
}

async function loadCurrentYear(year: number): Promise<Omit<ManureAppData, 'previousLoads'>> {
  info('Loading current manure data for year=%d', year);
  try {
    await ensureYearBootstrap(year);
  } catch (error) {
    if (!isOfflineFirestoreError(error)) {
      throw error;
    }
    warn('Unable to bootstrap year %d while offline. Falling back to cached data. Error = %O', year, error);
  }

  const offlineYearMessage = `Unable to load manure data for ${year} while offline. Connect once online so it can be cached, then retry.`;
  const yearSnapshot = await getDocWithOfflineFallback(yearDocRef(year), offlineYearMessage);
  const [ fieldSnapshot, sourceSnapshot, driverSnapshot, loadSnapshot, regionSnapshot, assignmentSnapshot ] = await Promise.all([
    getDocsWithOfflineFallback(metadataCollectionRef(year, 'fields'), `${MANURE_YEARS_COLLECTION}/${year}/fields`, offlineYearMessage),
    getDocsWithOfflineFallback(metadataCollectionRef(year, 'sources'), `${MANURE_YEARS_COLLECTION}/${year}/sources`, offlineYearMessage),
    getDocsWithOfflineFallback(metadataCollectionRef(year, 'drivers'), `${MANURE_YEARS_COLLECTION}/${year}/drivers`, offlineYearMessage),
    getDocsWithOfflineFallback(subcollectionRef(year, 'loads'), `${MANURE_YEARS_COLLECTION}/${year}/loads`, offlineYearMessage),
    getDocsWithOfflineFallback(spreadRegionsCollectionRef(year), `${MANURE_YEARS_COLLECTION}/${year}/${SPREAD_REGIONS_COLLECTION}`, offlineYearMessage),
    getDocsWithOfflineFallback(spreadRegionAssignmentsCollectionRef(year), `${MANURE_YEARS_COLLECTION}/${year}/${SPREAD_REGION_ASSIGNMENTS_COLLECTION}`, offlineYearMessage),
  ]);

  const currentYear: Omit<ManureAppData, 'previousLoads'> = {
    year,
    fields: sortByName(fieldSnapshot.docs.map(toField)),
    sources: sortByName(normalizeSourcesDefaults(sourceSnapshot.docs.map(toSource))),
    drivers: sortByName(driverSnapshot.docs.map(toDriver)),
    loads: sortLoads(loadSnapshot.docs.map(toLoad)),
    regions: sortSpreadRegions(regionSnapshot.docs.map(toSpreadRegion)),
    regionAssignments: sortSpreadRegionAssignments(assignmentSnapshot.docs.map(toSpreadRegionAssignment)),
  };

  const currentSchemaVersion = Number((yearSnapshot.data() as { schemaVersion?: unknown } | undefined)?.schemaVersion || 1);
  if (!yearSnapshot.metadata.fromCache) {
    await migrateYearSchemaIfNeeded(year, currentYear, currentSchemaVersion);
  }

  info(
    'Loaded current manure data for year=%d fields=%d sources=%d drivers=%d loads=%d regions=%d assignments=%d',
    year,
    fieldSnapshot.size,
    sourceSnapshot.size,
    driverSnapshot.size,
    loadSnapshot.size,
    regionSnapshot.size,
    assignmentSnapshot.size,
  );

  return currentYear;
}

export async function loadManureAppData(year: number): Promise<ManureAppData> {
  const currentYear = await loadCurrentYear(year);
  let previousLoads: LoadsRecord[] = [];

  try {
    const previousSnapshot = await getDocsWithOfflineFallback(
      subcollectionRef(year - 1, 'loads'),
      `${MANURE_YEARS_COLLECTION}/${year - 1}/loads`,
      `Unable to load previous manure loads for ${year - 1} while offline. Connect once online so they can be cached, then retry.`,
    );
    previousLoads = sortLoads(previousSnapshot.docs.map(toLoad));
    info('Loaded previous-year manure loads for year=%d count=%d', year - 1, previousSnapshot.size);
  } catch (error) {
    warn('Unable to load previous year loads. Continuing without them. Error = %O', error);
  }

  return {
    ...currentYear,
    previousLoads,
  };
}

export async function saveFields(year: number, fields: Field[], actorEmail: string): Promise<Field[]> {
  await ensureYearDocument(year);

  const normalizedFields = fields.map((field) => {
    const timestamp = nowIso();
    const acreage = nominalFieldAcreage(field.name, field.boundary);
    return {
      ...field,
      acreage,
      id: field.id || makeEntityId('field'),
      createdAt: field.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: actorEmail,
    };
  });

  const currentSnapshot = await getDocsWithOfflineFallback(
    metadataCollectionRef(year, 'fields'),
    `${MANURE_YEARS_COLLECTION}/${year}/fields`,
    `Unable to update fields for ${year} while offline before the current field list has been cached. Connect once online, then retry.`,
  );
  const nextIds = new Set(normalizedFields.map(field => field.id!));
  const batch = writeBatch(firestore());

  for (const docSnapshot of currentSnapshot.docs) {
    if (!nextIds.has(docSnapshot.id)) {
      batch.delete(docSnapshot.ref);
    }
  }

  for (const field of normalizedFields) {
    batch.set(doc(metadataCollectionRef(year, 'fields'), field.id!), stripUndefined({
      name: field.name,
      acreage: field.acreage,
      boundary: serializeFieldBoundary(field.boundary),
      defaultHeadingDegrees: field.defaultHeadingDegrees,
      createdAt: field.createdAt,
      updatedAt: field.updatedAt,
      updatedBy: field.updatedBy,
    }));
  }

  await batch.commit();
  info('Saved manure fields for year=%d count=%d actor=%s', year, normalizedFields.length, actorEmail);
  return sortByName(normalizedFields);
}

export async function saveSources(year: number, sources: Source[], actorEmail: string): Promise<Source[]> {
  await ensureYearDocument(year);
  const normalizedSources = normalizeSourcesDefaults(sources).map((source) => {
    const timestamp = nowIso();
    return {
      ...source,
      id: source.id || makeEntityId('source'),
      createdAt: source.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: actorEmail,
    };
  });

  const currentSnapshot = await getDocsWithOfflineFallback(
    metadataCollectionRef(year, 'sources'),
    `${MANURE_YEARS_COLLECTION}/${year}/sources`,
    `Unable to update sources for ${year} while offline before the current source list has been cached. Connect once online, then retry.`,
  );
  const nextIds = new Set(normalizedSources.map(source => source.id!));
  const batch = writeBatch(firestore());

  for (const docSnapshot of currentSnapshot.docs) {
    if (!nextIds.has(docSnapshot.id)) {
      batch.delete(docSnapshot.ref);
    }
  }

  for (const source of normalizedSources) {
    batch.set(doc(metadataCollectionRef(year, 'sources'), source.id!), stripUndefined({
      name: source.name,
      type: source.type,
      acPerLoad: source.acPerLoad,
      spreadWidthFeet: source.spreadWidthFeet,
      defaultLoadLengthFeet: source.defaultLoadLengthFeet,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      updatedBy: source.updatedBy,
    }));
  }

  await batch.commit();
  info('Saved manure sources for year=%d count=%d actor=%s', year, normalizedSources.length, actorEmail);
  return sortByName(normalizedSources);
}

export async function saveDrivers(year: number, drivers: Driver[], actorEmail: string): Promise<Driver[]> {
  await ensureYearDocument(year);

  const normalizedDrivers = drivers.map((driver) => {
    const timestamp = nowIso();
    return {
      ...driver,
      id: driver.id || makeEntityId('driver'),
      createdAt: driver.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: actorEmail,
    };
  });

  const currentSnapshot = await getDocsWithOfflineFallback(
    metadataCollectionRef(year, 'drivers'),
    `${MANURE_YEARS_COLLECTION}/${year}/drivers`,
    `Unable to update drivers for ${year} while offline before the current driver list has been cached. Connect once online, then retry.`,
  );
  const nextIds = new Set(normalizedDrivers.map(driver => driver.id!));
  const batch = writeBatch(firestore());

  for (const docSnapshot of currentSnapshot.docs) {
    if (!nextIds.has(docSnapshot.id)) {
      batch.delete(docSnapshot.ref);
    }
  }

  for (const driver of normalizedDrivers) {
    batch.set(doc(metadataCollectionRef(year, 'drivers'), driver.id!), stripUndefined({
      name: driver.name,
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
      updatedBy: driver.updatedBy,
    }));
  }

  await batch.commit();
  info('Saved manure drivers for year=%d count=%d actor=%s', year, normalizedDrivers.length, actorEmail);
  return sortByName(normalizedDrivers);
}

export function createLoadRecordId(load: Pick<LoadsRecord, 'date' | 'field' | 'source' | 'driver'>): string {
  return [
    load.date,
    normalizeKeyPart(load.field),
    normalizeKeyPart(load.source),
    normalizeKeyPart(load.driver),
  ].join('__');
}

export function createSpreadRegionAssignmentId(
  assignment: Pick<SpreadRegionAssignment, 'regionId' | 'loadGroupKey'>,
): string {
  return `${assignment.regionId}__${assignment.loadGroupKey}`;
}

export async function saveSpreadRegions(
  year: number,
  regions: SpreadRegion[],
  actorEmail: string,
): Promise<SpreadRegion[]> {
  await ensureYearDocument(year);

  const normalizedRegions = regions.map((region) => {
    const timestamp = nowIso();
    return {
      ...region,
      id: region.id || makeEntityId('region'),
      polygon: normalizePolygonFeature(region.polygon),
      centerline: region.centerline ? normalizeLineFeature(region.centerline) : undefined,
      createdAt: region.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: actorEmail,
    };
  });

  const currentSnapshot = await getDocsWithOfflineFallback(
    spreadRegionsCollectionRef(year),
    `${MANURE_YEARS_COLLECTION}/${year}/${SPREAD_REGIONS_COLLECTION}`,
    `Unable to update spread regions for ${year} while offline before the current region list has been cached. Connect once online, then retry.`,
  );
  const nextIds = new Set(normalizedRegions.map(region => region.id!));
  const batch = writeBatch(firestore());

  for (const docSnapshot of currentSnapshot.docs) {
    if (!nextIds.has(docSnapshot.id)) {
      batch.delete(docSnapshot.ref);
    }
  }

  for (const region of normalizedRegions) {
    batch.set(doc(spreadRegionsCollectionRef(year), region.id!), stripUndefined({
      field: region.field,
      mode: region.mode,
      polygon: serializePolygonFeature(region.polygon),
      centerline: region.centerline ? serializeLineFeature(region.centerline) : undefined,
      headingDegrees: region.headingDegrees,
      spreadWidthFeet: region.spreadWidthFeet,
      dateStart: region.dateStart,
      dateEnd: region.dateEnd,
      supersededByRegionId: region.supersededByRegionId,
      createdAt: region.createdAt,
      updatedAt: region.updatedAt,
      updatedBy: region.updatedBy,
    }));
  }

  await batch.commit();
  info('Saved manure spread regions for year=%d count=%d actor=%s', year, normalizedRegions.length, actorEmail);
  return sortSpreadRegions(normalizedRegions);
}

export async function saveSpreadRegionAssignments(
  year: number,
  assignments: SpreadRegionAssignment[],
  actorEmail: string,
): Promise<SpreadRegionAssignment[]> {
  await ensureYearDocument(year);

  const normalizedAssignments = assignments.map((assignment) => {
    const timestamp = nowIso();
    const loadGroupKey = createLoadGroupKey(assignment);
    return {
      ...assignment,
      id: assignment.id || createSpreadRegionAssignmentId({
        regionId: assignment.regionId,
        loadGroupKey,
      }),
      loadGroupKey,
      createdAt: assignment.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: actorEmail,
    };
  });

  const currentSnapshot = await getDocsWithOfflineFallback(
    spreadRegionAssignmentsCollectionRef(year),
    `${MANURE_YEARS_COLLECTION}/${year}/${SPREAD_REGION_ASSIGNMENTS_COLLECTION}`,
    `Unable to update spread region assignments for ${year} while offline before the current assignment list has been cached. Connect once online, then retry.`,
  );
  const nextIds = new Set(normalizedAssignments.map(assignment => assignment.id!));
  const batch = writeBatch(firestore());

  for (const docSnapshot of currentSnapshot.docs) {
    if (!nextIds.has(docSnapshot.id)) {
      batch.delete(docSnapshot.ref);
    }
  }

  for (const assignment of normalizedAssignments) {
    batch.set(doc(spreadRegionAssignmentsCollectionRef(year), assignment.id!), stripUndefined({
      regionId: assignment.regionId,
      loadGroupKey: assignment.loadGroupKey,
      date: assignment.date,
      field: assignment.field,
      source: assignment.source,
      loadCount: assignment.loadCount,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
      updatedBy: assignment.updatedBy,
    }));
  }

  await batch.commit();
  info('Saved manure spread region assignments for year=%d count=%d actor=%s', year, normalizedAssignments.length, actorEmail);
  return sortSpreadRegionAssignments(normalizedAssignments);
}

export async function saveLoadRecord(year: number, load: LoadsRecord, actorEmail: string): Promise<LoadsRecord> {
  await ensureYearDocument(year);

  const id = load.id || createLoadRecordId(load);
  const timestamp = nowIso();
  const normalizedLoad: LoadsRecord = {
    ...load,
    id,
    createdAt: load.createdAt || timestamp,
    updatedAt: timestamp,
    updatedBy: actorEmail,
  };

  await setDoc(
    doc(subcollectionRef(year, 'loads'), id),
    stripUndefined({
      date: normalizedLoad.date,
      field: normalizedLoad.field,
      source: normalizedLoad.source,
      loads: normalizedLoad.loads,
      driver: normalizedLoad.driver,
      geojson: normalizedLoad.geojson,
      createdAt: normalizedLoad.createdAt,
      updatedAt: normalizedLoad.updatedAt,
      updatedBy: normalizedLoad.updatedBy,
    }),
  );
  info(
    'Saved manure load record year=%d id=%s date=%s field=%s source=%s driver=%s loads=%d actor=%s',
    year,
    id,
    normalizedLoad.date,
    normalizedLoad.field,
    normalizedLoad.source,
    normalizedLoad.driver,
    normalizedLoad.loads,
    actorEmail,
  );

  return normalizedLoad;
}

export async function getAccessRecord(email: string): Promise<AccessRecord | null> {
  const normalizedEmail = emailKey(email);
  info(
    'Loading manure access record for requestedEmail=%s currentAuth=%O',
    normalizedEmail,
    currentAuthSummary(),
  );
  await logCurrentAuthTokenSummary(`About to load manure access record requestedEmail=${normalizedEmail}`);

  let snapshot;
  try {
    snapshot = await getDocWithOfflineFallback(
      accessDocRef(email),
      'Unable to verify manure access while offline. Connect once online so your allowlist record can be cached, then retry.',
    );
  } catch (error) {
    warn(
      'Loading manure access record failed requestedEmail=%s currentAuth=%O error=%O',
      normalizedEmail,
      currentAuthSummary(),
      error,
    );
    await logCurrentAuthTokenSummary(`Failed to load manure access record requestedEmail=${normalizedEmail}`);
    throw error;
  }
  if (!snapshot.exists()) {
    info('No manure access record exists for email=%s', normalizedEmail);
    return null;
  }

  const data = snapshot.data() as Omit<AccessRecord, 'email'>;
  info('Loaded manure access record for email=%s enabled=%s admin=%s', snapshot.id, !!data.enabled, !!data.admin);
  return {
    email: snapshot.id,
    ...data,
  };
}

export async function listAccessRecords(): Promise<AccessRecord[]> {
  info('Loading manure access records list');
  const snapshot = await getDocsWithOfflineFallback(
    accessCollectionRef(),
    MANURE_ACCESS_COLLECTION,
    'Unable to load manure access records while offline. Connect once online so they can be cached, then retry.',
  );
  const records = sortAccessRecords(snapshot.docs.map(toAccessRecord));
  info('Loaded manure access records count=%d', records.length);
  return records;
}

export async function saveAccessRecord(record: AccessRecord, actorEmail: string): Promise<AccessRecord> {
  const email = emailKey(record.email);
  const timestamp = nowIso();
  const normalizedRecord: AccessRecord = {
    ...record,
    email,
    displayName: record.displayName?.trim() || undefined,
    createdAt: record.createdAt || timestamp,
    updatedAt: timestamp,
    updatedBy: actorEmail,
  };

  await setDoc(
    accessDocRef(email),
    stripUndefined({
      enabled: normalizedRecord.enabled,
      admin: normalizedRecord.admin,
      displayName: normalizedRecord.displayName,
      createdAt: normalizedRecord.createdAt,
      updatedAt: normalizedRecord.updatedAt,
      updatedBy: normalizedRecord.updatedBy,
    }),
  );
  info(
    'Saved manure access record email=%s enabled=%s admin=%s actor=%s',
    email,
    normalizedRecord.enabled,
    normalizedRecord.admin,
    actorEmail,
  );
  return normalizedRecord;
}

export async function deleteAccessRecord(email: string): Promise<void> {
  const normalizedEmail = emailKey(email);
  await deleteDoc(accessDocRef(normalizedEmail));
  info('Deleted manure access record email=%s', normalizedEmail);
}

export function isAccessEnabled(record: AccessRecord | null): record is AccessRecord {
  return !!record?.enabled;
}

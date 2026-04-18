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
import type { AccessRecord, Driver, Field, LoadsRecord, ManureAppData, Source } from './types.js';

const info = debug('af/manure-lib:info');
const warn = debug('af/manure-lib:warn');

const MANURE_YEARS_COLLECTION = 'manureYears';
const MANURE_ACCESS_COLLECTION = 'manureAccess';
const METADATA_COLLECTIONS = [ 'fields', 'sources', 'drivers' ] as const;

type MetadataCollectionName = typeof METADATA_COLLECTIONS[number];

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

function yearDocRef(year: number) {
  return doc(firestore(), MANURE_YEARS_COLLECTION, String(year));
}

function subcollectionRef(year: number, name: string) {
  return collection(yearDocRef(year), name);
}

function metadataCollectionRef(year: number, name: MetadataCollectionName) {
  return subcollectionRef(year, name);
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
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<Field, 'id'>),
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

function toAccessRecord(snapshot: QueryDocumentSnapshot<DocumentData>): AccessRecord {
  return {
    email: snapshot.id,
    ...(snapshot.data() as Omit<AccessRecord, 'email'>),
  };
}

function sortAccessRecords(records: AccessRecord[]): AccessRecord[] {
  return [ ...records ].sort((left, right) => left.email.localeCompare(right.email));
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
    schemaVersion: 1,
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

  const [ fieldSnapshot, sourceSnapshot, driverSnapshot, loadSnapshot ] = await Promise.all([
    getDocsWithOfflineFallback(metadataCollectionRef(year, 'fields'), `${MANURE_YEARS_COLLECTION}/${year}/fields`, offlineYearMessage),
    getDocsWithOfflineFallback(metadataCollectionRef(year, 'sources'), `${MANURE_YEARS_COLLECTION}/${year}/sources`, offlineYearMessage),
    getDocsWithOfflineFallback(metadataCollectionRef(year, 'drivers'), `${MANURE_YEARS_COLLECTION}/${year}/drivers`, offlineYearMessage),
    getDocsWithOfflineFallback(subcollectionRef(year, 'loads'), `${MANURE_YEARS_COLLECTION}/${year}/loads`, offlineYearMessage),
  ]);

  info(
    'Loaded current manure data for year=%d fields=%d sources=%d drivers=%d loads=%d',
    year,
    fieldSnapshot.size,
    sourceSnapshot.size,
    driverSnapshot.size,
    loadSnapshot.size,
  );

  return {
    year,
    fields: sortByName(fieldSnapshot.docs.map(toField)),
    sources: sortByName(sourceSnapshot.docs.map(toSource)),
    drivers: sortByName(driverSnapshot.docs.map(toDriver)),
    loads: sortLoads(loadSnapshot.docs.map(toLoad)),
  };
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
    return {
      ...field,
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
      boundary: field.boundary,
      createdAt: field.createdAt,
      updatedAt: field.updatedAt,
      updatedBy: field.updatedBy,
    }));
  }

  await batch.commit();
  info('Saved manure fields for year=%d count=%d actor=%s', year, normalizedFields.length, actorEmail);
  return sortByName(normalizedFields);
}

export function createLoadRecordId(load: Pick<LoadsRecord, 'date' | 'field' | 'source' | 'driver'>): string {
  return [
    load.date,
    normalizeKeyPart(load.field),
    normalizeKeyPart(load.source),
    normalizeKeyPart(load.driver),
  ].join('__');
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

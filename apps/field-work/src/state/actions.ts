import { action, runInAction } from 'mobx';
import debug from 'debug';
import * as trellolib from '@aultfarms/trello';
import {
  addFieldToOperationExclude,
  addFieldToOperationInclude,
  deleteOperationCompletion,
  defaultFieldAreaAcres,
  type FieldBoundary,
  fieldWorkTrelloConfig,
  fieldWorkBoard,
  normalizeFieldReference,
  removeFieldFromOperationExclude,
  saveCropLists,
  saveFields,
  saveOperationCropFilter as persistOperationCropFilter,
  saveOperationDefinition as persistOperationDefinition,
  saveOperationOptions,
  saveOperationCompletion,
  type CompletionValues,
  type CropInput,
  type CropList,
  type FieldDefinition,
  type FieldInput,
  type FieldWorkBoard,
  type OperationList,
  type OperationOption,
  type OperationOptionInput,
} from '@aultfarms/field-work';
import { boundsForBoundary, boundsForFields, boundsForPoint, extendBoundsToIncludePoint, parseKMZIntoEditableFields } from '../util';
import { state, type AppIssue, type EditableCrop, type EditableField, type EditableOption, type FieldModalAction, type State } from './state';

const info = debug('af/field-work:info');
const trelloPublicApiKey = '3ad06cb25802014a3f24f479e886771c';
const trelloTokenStorageKey = 'trello_token';
const fieldWorkLocalStorageKeys = [
  'af.field-work.map',
  'af.field-work.operation',
  'af.field-work.operation-options',
] as const;

function persistMapView(): void {
  localStorage.setItem('af.field-work.map', JSON.stringify(state.mapView));
}

function persistSelectedOperation(): void {
  localStorage.setItem('af.field-work.operation', state.selectedOperationName);
}

function scrollMapElementIntoView(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const mapElement = document.getElementById('field-work-map');
  if (mapElement) {
    mapElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }
}

function queueMapBounds(nextBounds: State['mapBounds']): void {
  state.mapBounds = nextBounds;
  state.mapCommandId += 1;
}

function boundsIncludingCurrentLocation(nextBounds: State['mapBounds']): State['mapBounds'] {
  if (!state.currentLocation) {
    return nextBounds;
  }
  return extendBoundsToIncludePoint(nextBounds, state.currentLocation.center);
}

function readStoredTrelloToken(): string {
  try {
    return localStorage.getItem(trelloTokenStorageKey) || '';
  } catch (error) {
    void error;
    return '';
  }
}

function clearFieldWorkLocalCache(): void {
  try {
    fieldWorkLocalStorageKeys.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    void error;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchTrelloJson<T>(path: string, token: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const url = new URL(`https://api.trello.com/1${path.startsWith('/') ? path : `/${path}`}`);
  url.searchParams.set('key', trelloPublicApiKey);
  url.searchParams.set('token', token);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, `${value}`);
  });

  const response = await fetch(url.toString(), { method: 'GET' });
  const responseText = await response.text();
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    if (responseText) {
      try {
        const body = JSON.parse(responseText) as { message?: string };
        if (typeof body.message === 'string' && body.message.trim()) {
          message = `${message}: ${body.message}`;
        }
      } catch (error) {
        void error;
      }
    }
    throw new Error(message);
  }

  if (!responseText) {
    return {} as T;
  }
  return JSON.parse(responseText) as T;
}

function readStoredOperationOptionDefaults(): Record<string, CompletionValues> {
  try {
    const raw = JSON.parse(localStorage.getItem('af.field-work.operation-options') || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const defaults: Record<string, CompletionValues> = {};
    for (const [operationName, operationValues] of Object.entries(raw)) {
      if (!operationValues || typeof operationValues !== 'object' || Array.isArray(operationValues)) {
        continue;
      }

      const values: CompletionValues = {};
      for (const [typeKey, value] of Object.entries(operationValues)) {
        if (typeof value === 'string' && value.trim()) {
          values[typeKey] = value;
        }
      }
      defaults[operationName] = values;
    }

    return defaults;
  } catch (error) {
    void error;
    return {};
  }
}

function persistOperationOptionDefaults(defaults: Record<string, CompletionValues>): void {
  try {
    localStorage.setItem('af.field-work.operation-options', JSON.stringify(defaults));
  } catch (error) {
    void error;
  }
}

function currentDate(): string {
  return new Date().toISOString().split('T')[0] || '';
}
function sortStrings(values: string[]): string[] {
  return [ ...values ].sort((left, right) => left.localeCompare(right));
}

function cloneField(field: EditableField): EditableField {
  return {
    cardId: field.cardId,
    name: field.name,
    aliases: [ ...field.aliases ],
    acreage: field.acreage,
    boundary: field.boundary,
  };
}

function cloneCrop(crop: EditableCrop): EditableCrop {
  return {
    idList: crop.idList,
    name: crop.name,
    isTemplate: crop.isTemplate,
    fieldNames: [ ...crop.fieldNames ],
  };
}

function cloneOption(option: EditableOption): EditableOption {
  return {
    key: option.key,
    cardId: option.cardId,
    type: option.type,
    name: option.name,
    description: option.description,
  };
}

function editableOptionFromOperationOption(option: OperationOption): EditableOption {
  return {
    key: option.cardId,
    cardId: option.cardId,
    type: option.type,
    name: option.name,
    description: option.description,
  };
}

function editableCropFromList(crop: CropList): EditableCrop {
  return {
    idList: crop.idList,
    name: crop.crop,
    isTemplate: crop.isTemplate,
    fieldNames: [ ...crop.fieldNames ],
  };
}

function editableFieldFromDefinition(field: FieldDefinition): EditableField {
  return {
    cardId: field.cardId,
    name: field.name,
    aliases: [ ...field.aliases ],
    acreage: field.acreage,
    boundary: field.boundary,
  };
}

function selectedOperation(): OperationList | null {
  if (!state.board || !state.selectedOperationName) {
    return null;
  }
  return state.board.operations.find(operation => operation.name === state.selectedOperationName) || null;
}

function syncOptionDraftsForOperation(operationName: string): void {
  const operation = state.board?.operations.find(candidate => candidate.name === operationName) || null;
  replaceOptionDrafts(editableOptionsFromOperation(operation));
  state.optionDraftsDirty = false;
}

function ensureSelectedManagerField(nextDrafts: EditableField[]): string {
  if (nextDrafts.find(field => field.name === state.selectedManagerFieldName)) {
    return state.selectedManagerFieldName;
  }
  return nextDrafts[0]?.name || '';
}
function ensureSelectedCrop(nextDrafts: EditableCrop[]): string {
  if (nextDrafts.find(crop => crop.name === state.selectedCropName)) {
    return state.selectedCropName;
  }
  return nextDrafts[0]?.name || '';
}

function replaceFieldDrafts(nextDrafts: EditableField[]): void {
  state.fieldDrafts = nextDrafts;
  state.selectedManagerFieldName = ensureSelectedManagerField(nextDrafts);
}

function replaceCropDrafts(nextDrafts: EditableCrop[]): void {
  state.cropDrafts = nextDrafts;
  state.selectedCropName = ensureSelectedCrop(nextDrafts);
}

function replaceOptionDrafts(nextDrafts: EditableOption[]): void {
  state.optionDrafts = nextDrafts;
}

function editableOptionsFromOperation(operation: OperationList | null): EditableOption[] {
  return Object.values(operation?.metadata.optionsByType || {})
    .flat()
    .sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name))
    .map(editableOptionFromOperationOption);
}

function nextNewFieldName(): string {
  let counter = 1;
  while (state.fieldDrafts.find(field => normalizeFieldReference(field.name) === normalizeFieldReference(`New Field ${counter}`))) {
    counter += 1;
  }
  return `New Field ${counter}`;
}

function nextNewCropName(): string {
  let counter = 1;
  while (state.cropDrafts.find(crop => normalizeFieldReference(crop.name) === normalizeFieldReference(`New Crop ${counter}`))) {
    counter += 1;
  }
  return `New Crop ${counter}`;
}

let optionDraftCounter = 1;
function nextNewOptionDraftKey(): string {
  const nextKey = `new-option-${optionDraftCounter}`;
  optionDraftCounter += 1;
  return nextKey;
}

function selectedOperationFieldAction(fieldName: string): FieldModalAction {
  const operation = selectedOperation();
  if (!operation) {
    return '';
  }
  const fieldState = operation.fieldStateByName[fieldName];
  if (!fieldState) {
    return '';
  }
  if (fieldState.status === 'completed') {
    return 'uncomplete';
  }
  if (fieldState.status === 'planned') {
    return 'complete';
  }
  return fieldState.excluded ? 'remove_exclude' : 'include';
}

function defaultCompletionValues(operation: OperationList): CompletionValues {
  const storedDefaults = readStoredOperationOptionDefaults()[operation.name] || {};
  const values: CompletionValues = {};
  for (const [typeKey, options] of Object.entries(operation.metadata.optionsByType)) {
    const storedValue = storedDefaults[typeKey];
    if (storedValue && options.some(option => option.name === storedValue)) {
      values[typeKey] = storedValue;
      continue;
    }
    const firstOption = options[0];
    if (firstOption) {
      values[typeKey] = firstOption.name;
    }
  }
  return values;
}

function rememberOperationOptionDefaults(operation: OperationList, values: CompletionValues): void {
  const nextValues: CompletionValues = {};
  for (const [typeKey, options] of Object.entries(operation.metadata.optionsByType)) {
    const currentValue = values[typeKey];
    if (currentValue && options.some(option => option.name === currentValue)) {
      nextValues[typeKey] = currentValue;
    }
  }

  const defaults = readStoredOperationOptionDefaults();
  defaults[operation.name] = nextValues;
  persistOperationOptionDefaults(defaults);
}

function issueKey(issue: Pick<AppIssue, 'level' | 'source' | 'message'>): string {
  return `${issue.level}:${issue.source}:${issue.message}`;
}

function boardIssues(board: FieldWorkBoard): Array<Omit<AppIssue, 'key' | 'count'>> {
  return [
    ...board.errors.map((message) => ({ level: 'error' as const, source: 'board' as const, message })),
    ...board.warnings.map((message) => ({ level: 'warning' as const, source: 'board' as const, message })),
  ];
}

export const loading = action('loading', (nextLoading: boolean) => {
  state.loading = nextLoading;
});

export const recordIssues = action('recordIssues', (issues: Array<Omit<AppIssue, 'key' | 'count'>>) => {
  if (issues.length < 1) {
    return;
  }

  const nextIssues = [ ...state.issues ];
  for (const issue of issues) {
    const message = issue.message.trim();
    if (!message) {
      continue;
    }

    const key = issueKey({ ...issue, message });
    const existingIndex = nextIssues.findIndex(existing => existing.key === key);
    if (existingIndex >= 0) {
      const existingIssue = nextIssues[existingIndex];
      if (!existingIssue) {
        continue;
      }
      nextIssues[existingIndex] = {
        ...existingIssue,
        count: existingIssue.count + 1,
      };
      continue;
    }

    nextIssues.push({
      key,
      ...issue,
      message,
      count: 1,
    });
  }

  state.issues = nextIssues;
});

export const loadingError = action('loadingError', (message: string) => {
  state.loadingError = message;
  if (message) {
    recordIssues([{ level: 'error', source: 'runtime', message }]);
    snackbarMessage(message);
  }
});

export const clearTrelloDiagnostics = action('clearTrelloDiagnostics', () => {
  state.trelloDiagnostics = {
    loading: false,
    error: '',
    tokenStorageKey: trelloTokenStorageKey,
    tokenPresent: !!readStoredTrelloToken(),
    expectedOrgName: trellolib.defaultOrg,
    expectedBoardName: fieldWorkTrelloConfig.board,
    user: null,
    organizations: [],
    defaultOrganizationFound: false,
    defaultOrganizationId: '',
    boardsInDefaultOrganization: [],
  };
});

export const loadTrelloDiagnostics = action('loadTrelloDiagnostics', async () => {
  const token = readStoredTrelloToken();
  runInAction(() => {
    state.trelloDiagnostics = {
      loading: true,
      error: '',
      tokenStorageKey: trelloTokenStorageKey,
      tokenPresent: !!token,
      expectedOrgName: trellolib.defaultOrg,
      expectedBoardName: fieldWorkTrelloConfig.board,
      user: null,
      organizations: [],
      defaultOrganizationFound: false,
      defaultOrganizationId: '',
      boardsInDefaultOrganization: [],
    };
  });

  if (!token) {
    runInAction(() => {
      state.trelloDiagnostics.loading = false;
      state.trelloDiagnostics.error = 'No Trello token was found in localStorage.';
    });
    return;
  }

  try {
    const rawUser = await fetchTrelloJson<Record<string, unknown>>('/members/me', token, { fields: 'all' });
    const rawOrganizations = await fetchTrelloJson<Array<Record<string, unknown>>>('/members/me/organizations', token, { fields: 'id,name,displayName' });
    const organizations = rawOrganizations.map(org => ({
      id: stringValue(org.id),
      name: stringValue(org.name),
      displayName: stringValue(org.displayName),
    }));
    const defaultOrganization = organizations.find(org => org.displayName === trellolib.defaultOrg || org.name === trellolib.defaultOrg) || null;
    let boardsInDefaultOrganization: State['trelloDiagnostics']['boardsInDefaultOrganization'] = [];
    if (defaultOrganization?.id) {
      const rawBoards = await fetchTrelloJson<Array<Record<string, unknown>>>(`/organizations/${defaultOrganization.id}/boards`, token, { fields: 'id,name,closed,url' });
      boardsInDefaultOrganization = rawBoards.map(board => ({
        id: stringValue(board.id),
        name: stringValue(board.name),
        closed: !!board.closed,
        url: stringValue(board.url),
      }));
    }

    const email = stringValue(rawUser.email) || stringValue(rawUser.aaEmail);
    runInAction(() => {
      state.trelloDiagnostics = {
        loading: false,
        error: '',
        tokenStorageKey: trelloTokenStorageKey,
        tokenPresent: true,
        expectedOrgName: trellolib.defaultOrg,
        expectedBoardName: fieldWorkTrelloConfig.board,
        user: {
          id: stringValue(rawUser.id),
          username: stringValue(rawUser.username),
          fullName: stringValue(rawUser.fullName),
          email,
          url: stringValue(rawUser.url),
        },
        organizations,
        defaultOrganizationFound: !!defaultOrganization,
        defaultOrganizationId: defaultOrganization?.id || '',
        boardsInDefaultOrganization,
      };
    });
  } catch (error) {
    runInAction(() => {
      state.trelloDiagnostics.loading = false;
      state.trelloDiagnostics.error = `Unable to load Trello diagnostics: ${(error as Error).message}`;
    });
  }
});

export const currentLocation = action('currentLocation', (nextLocation: State['currentLocation']) => {
  state.currentLocation = nextLocation;
});

export const clearCurrentLocation = action('clearCurrentLocation', () => {
  state.currentLocation = null;
});

export const locateMeOnMap = action('locateMeOnMap', () => {
  if (!state.currentLocation) {
    snackbarMessage('Current GPS location is not available yet');
    return;
  }
  queueMapBounds(boundsForPoint(state.currentLocation.center));
});

export const showAllFieldsOnMap = action('showAllFieldsOnMap', () => {
  fitAllFields();
  scrollMapElementIntoView();
});

export const showFieldOnMap = action('showFieldOnMap', (fieldName: string) => {
  moveMapToField(fieldName);
  scrollMapElementIntoView();
});

export const setTrelloAuthorized = action('setTrelloAuthorized', (authorized: boolean) => {
  state.trelloAuthorized = authorized;
});

export const openAuthScreen = action('openAuthScreen', async () => {
  state.authScreenOpen = true;
  await loadTrelloDiagnostics();
});

export const closeAuthScreen = action('closeAuthScreen', () => {
  state.authScreenOpen = false;
});

export const snackbarMessage = action('snackbarMessage', (message: string) => {
  state.snackbar.open = true;
  state.snackbar.message = message;
});

export const closeSnackbar = action('closeSnackbar', () => {
  state.snackbar.open = false;
});

export const openIssuesModal = action('openIssuesModal', () => {
  state.issuesModalOpen = true;
});

export const closeIssuesModal = action('closeIssuesModal', () => {
  state.issuesModalOpen = false;
});

export const mode = action('mode', (nextMode: State['mode']) => {
  state.mode = nextMode;
  if (nextMode === 'field_manager' && !state.selectedManagerFieldName) {
    state.selectedManagerFieldName = state.fieldDrafts[0]?.name || '';
  }
  if (nextMode === 'crops_manager' && !state.selectedCropName) {
    state.selectedCropName = state.cropDrafts[0]?.name || '';
  }
  if (nextMode === 'options_manager') {
    if (!state.selectedOperationName) {
      state.selectedOperationName = state.board?.operations[0]?.name || '';
      persistSelectedOperation();
    }
    syncOptionDraftsForOperation(state.selectedOperationName);
  }
});

export const mapView = action('mapView', (nextMapView: Partial<State['mapView']>) => {
  state.mapView = {
    ...state.mapView,
    ...nextMapView,
  };
  persistMapView();
});

export const selectedOperationName = action('selectedOperationName', (name: string) => {
  state.selectedOperationName = name;
  persistSelectedOperation();
  syncOptionDraftsForOperation(name);
});

export const selectedCropName = action('selectedCropName', (name: string) => {
  state.selectedCropName = name;
});

export const fitAllFields = action('fitAllFields', () => {
  const fields = state.mode === 'field_manager'
    ? state.fieldDrafts
    : (state.board?.fields || []).map(editableFieldFromDefinition);
  const nextBounds = boundsIncludingCurrentLocation(boundsForFields(fields));
  if (!nextBounds) {
    return;
  }
  queueMapBounds(nextBounds);
});

export const moveMapToField = action('moveMapToField', (fieldName: string) => {
  const managerField = state.fieldDrafts.find(field => field.name === fieldName) || null;
  if (managerField?.boundary) {
    queueMapBounds(boundsIncludingCurrentLocation(boundsForBoundary(managerField.boundary)));
    return;
  }

  const boardField = state.board?.fields.find(field => field.name === fieldName) || null;
  if (boardField?.boundary) {
    queueMapBounds(boundsIncludingCurrentLocation(boundsForBoundary(boardField.boundary)));
  }
});

export const resetLocalCache = action('resetLocalCache', async () => {
  clearFieldWorkLocalCache();
  clearTrelloDiagnostics();
  cachedTrelloClient = null;

  try {
    const client = trellolib.getClient();
    await client.deauthorize();
  } catch (error) {
    void error;
    try {
      localStorage.removeItem(trelloTokenStorageKey);
    } catch (storageError) {
      void storageError;
    }
  } finally {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }
});

export const openFieldModal = action('openFieldModal', (fieldName: string) => {
  const operation = selectedOperation();
  if (!operation) {
    snackbarMessage('Select an operation first');
    return;
  }

  const fieldState = operation.fieldStateByName[fieldName];
  if (!fieldState) {
    return;
  }

  const modalAction = selectedOperationFieldAction(fieldName);
  const values = fieldState.completion
    ? { ...fieldState.completion.values }
    : defaultCompletionValues(operation);
  delete values.note;

  state.fieldModal = {
    open: true,
    fieldName,
    action: modalAction,
    date: fieldState.completion?.date || currentDate(),
    note: fieldState.completion?.note || '',
    values,
  };
});

export const closeFieldModal = action('closeFieldModal', () => {
  state.fieldModal = {
    open: false,
    fieldName: '',
    action: '',
    date: currentDate(),
    note: '',
    values: {},
  };
});

export const fieldModalDate = action('fieldModalDate', (date: string) => {
  state.fieldModal.date = date;
});

export const fieldModalNote = action('fieldModalNote', (note: string) => {
  state.fieldModal.note = note;
});

export const fieldModalValue = action('fieldModalValue', (key: string, value: string) => {
  state.fieldModal.values[key] = value;
});

export const applyBoard = action('applyBoard', (board: State['board']) => {
  state.board = board;
  replaceFieldDrafts((board?.fields || []).map(editableFieldFromDefinition));
  replaceCropDrafts((board?.cropLists || []).map(editableCropFromList));
  state.fieldDraftsDirty = false;
  state.cropDraftsDirty = false;
  if (state.selectedOperationName && !board?.operations.find(operation => operation.name === state.selectedOperationName)) {
    state.selectedOperationName = '';
    persistSelectedOperation();
  }
  syncOptionDraftsForOperation(state.selectedOperationName);
});

export const loadBoard = action('loadBoard', async (force?: true) => {
  loading(true);
  loadingError('');

  try {
    const board = await fieldWorkBoard({ client: await trello(), force });
    runInAction(() => {
      applyBoard(board);
    });

    if (board.errors.length > 0 || board.warnings.length > 0) {
      recordIssues(boardIssues(board));
      snackbarMessage(`Loaded with ${board.errors.length + board.warnings.length} field-work issue(s)`);
    }
  } catch (error) {
    loadingError(`Unable to load Field Work board: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

export const saveOptionDrafts = action('saveOptionDrafts', async () => {
  const operation = selectedOperation();
  if (!operation) {
    snackbarMessage('Select an operation first');
    return;
  }

  try {
    loading(true);
    const options: OperationOptionInput[] = state.optionDrafts.map(option => ({
      cardId: option.cardId,
      type: option.type,
      name: option.name,
      description: option.description,
    }));
    await saveOperationOptions({
      client: await trello(),
      operation,
      options,
    });
    runInAction(() => {
      state.optionDraftsDirty = false;
    });
    await loadBoard(true);
    snackbarMessage('Options saved');
  } catch (error) {
    loadingError(`Unable to save options: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

export const saveSelectedOperationCropFilter = action('saveSelectedOperationCropFilter', async (cropNames: string[]) => {
  const operation = selectedOperation();
  if (!operation) {
    snackbarMessage('Select an operation first');
    return;
  }

  try {
    loading(true);
    await persistOperationCropFilter({
      client: await trello(),
      operation,
      cropNames,
    });
    await loadBoard(true);
    snackbarMessage('Crop/template filter saved');
  } catch (error) {
    loadingError(`Unable to save crop/template filter: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

export const saveOperationDefinition = action('saveOperationDefinition', async ({
  operation,
  name,
  cropNames,
}: {
  operation?: OperationList;
  name: string;
  cropNames: string[];
}) => {
  try {
    loading(true);
    const savedOperation = await persistOperationDefinition({
      client: await trello(),
      operation,
      name,
      cropNames,
    });
    runInAction(() => {
      state.selectedOperationName = savedOperation.name;
      persistSelectedOperation();
    });
    await loadBoard(true);
    snackbarMessage(operation ? 'Operation updated' : 'Operation created');
    return true;
  } catch (error) {
    loadingError(`Unable to save operation: ${(error as Error).message}`);
    return false;
  } finally {
    loading(false);
  }
});

export const saveCropDrafts = action('saveCropDrafts', async () => {
  try {
    loading(true);
    const crops: CropInput[] = state.cropDrafts.map(crop => ({
      idList: crop.idList,
      name: crop.name,
      isTemplate: crop.isTemplate,
      fieldNames: crop.fieldNames,
    }));
    await saveCropLists({
      client: await trello(),
      crops,
    });
    runInAction(() => {
      state.cropDraftsDirty = false;
    });
    await loadBoard(true);
    snackbarMessage('Crops saved');
  } catch (error) {
    loadingError(`Unable to save crops: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

let cachedTrelloClient: trellolib.client.Client | null = null;
export const trello = action('trello', async () => {
  if (!cachedTrelloClient) {
    cachedTrelloClient = trellolib.getClient();
    await cachedTrelloClient.connect({ org: trellolib.defaultOrg });
  }
  return cachedTrelloClient;
});

export const loginWithTrello = action('loginWithTrello', async () => {
  info('Logging in with Trello');
  loading(true);
  loadingError('');
  clearTrelloDiagnostics();

  try {
    await trello();
    setTrelloAuthorized(true);
    await loadBoard(true);
    if (!state.board) {
      throw new Error(state.loadingError || `Unable to load ${fieldWorkTrelloConfig.board}`);
    }
    closeAuthScreen();
    clearTrelloDiagnostics();
  } catch (error) {
    setTrelloAuthorized(false);
    loadingError(`Unable to initialize Field Work: ${(error as Error).message}`);
    await loadTrelloDiagnostics();
  } finally {
    if (!state.board) {
      loading(false);
    }
  }
});

export const logoutTrello = action('logoutTrello', async () => {
  clearFieldWorkLocalCache();
  clearTrelloDiagnostics();
  cachedTrelloClient = null;
  try {
    const client = trellolib.getClient();
    await client.deauthorize();
  } finally {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }
});

export const handleMapFieldClick = action('handleMapFieldClick', (fieldName: string) => {
  if (state.mode === 'field_manager') {
    selectedManagerFieldName(fieldName);
    return;
  }
  if (state.mode === 'crops_manager') {
    if (!state.selectedCropName) {
      snackbarMessage('Select a crop/template first');
      return;
    }
    toggleCropDraftField(state.selectedCropName, fieldName);
    return;
  }
  if (!state.selectedOperationName) {
    snackbarMessage('Select an operation first');
    return;
  }
  openFieldModal(fieldName);
});

export const submitFieldModal = action('submitFieldModal', async () => {
  const operation = selectedOperation();
  if (!operation || !state.fieldModal.fieldName) {
    return;
  }

  try {
    if (state.fieldModal.action === 'complete') {
      const values: CompletionValues = {
        ...state.fieldModal.values,
      };
      if (state.fieldModal.note.trim()) {
        values.note = state.fieldModal.note.trim();
      }
      await saveOperationCompletion({
        client: await trello(),
        operation,
        fieldName: state.fieldModal.fieldName,
        date: state.fieldModal.date,
        values,
      });
      rememberOperationOptionDefaults(operation, state.fieldModal.values);
      snackbarMessage(`Completed ${state.fieldModal.fieldName}`);
    }

    if (state.fieldModal.action === 'uncomplete') {
      const completionId = operation.fieldStateByName[state.fieldModal.fieldName]?.completion?.cardId;
      if (!completionId) {
        throw new Error('Selected field does not have a completion card');
      }
      await deleteOperationCompletion({
        client: await trello(),
        completionCardId: completionId,
      });
      snackbarMessage(`Removed completion for ${state.fieldModal.fieldName}`);
    }

    if (state.fieldModal.action === 'include') {
      await addFieldToOperationInclude({
        client: await trello(),
        operation,
        fieldName: state.fieldModal.fieldName,
      });
      snackbarMessage(`Included ${state.fieldModal.fieldName}`);
    }

    if (state.fieldModal.action === 'remove_exclude') {
      await removeFieldFromOperationExclude({
        client: await trello(),
        operation,
        fieldName: state.fieldModal.fieldName,
      });
      snackbarMessage(`Removed exclusion for ${state.fieldModal.fieldName}`);
    }

    closeFieldModal();
    await loadBoard(true);
  } catch (error) {
    loadingError(`Unable to update operation: ${(error as Error).message}`);
  }
});

export const excludeFromFieldModal = action('excludeFromFieldModal', async () => {
  const operation = selectedOperation();
  if (!operation || !state.fieldModal.fieldName) {
    return;
  }

  try {
    await addFieldToOperationExclude({
      client: await trello(),
      operation,
      fieldName: state.fieldModal.fieldName,
    });
    closeFieldModal();
    await loadBoard(true);
    snackbarMessage(`Excluded ${state.fieldModal.fieldName}`);
  } catch (error) {
    loadingError(`Unable to exclude field: ${(error as Error).message}`);
  }
});

export const selectedManagerFieldName = action('selectedManagerFieldName', (fieldName: string) => {
  state.selectedManagerFieldName = fieldName;
  if (fieldName) {
    moveMapToField(fieldName);
  }
});
export const addOptionDraft = action('addOptionDraft', () => {
  replaceOptionDrafts([
    ...state.optionDrafts.map(cloneOption),
    {
      key: nextNewOptionDraftKey(),
      type: '',
      name: '',
      description: '',
    },
  ]);
  state.optionDraftsDirty = true;
});

export const optionDraftType = action('optionDraftType', (key: string, type: string) => {
  replaceOptionDrafts(state.optionDrafts.map((option) => {
    if (option.key !== key) {
      return option;
    }
    return {
      ...cloneOption(option),
      type,
    };
  }));
  state.optionDraftsDirty = true;
});

export const optionDraftName = action('optionDraftName', (key: string, name: string) => {
  replaceOptionDrafts(state.optionDrafts.map((option) => {
    if (option.key !== key) {
      return option;
    }
    return {
      ...cloneOption(option),
      name,
    };
  }));
  state.optionDraftsDirty = true;
});

export const optionDraftDescription = action('optionDraftDescription', (key: string, description: string) => {
  replaceOptionDrafts(state.optionDrafts.map((option) => {
    if (option.key !== key) {
      return option;
    }
    return {
      ...cloneOption(option),
      description,
    };
  }));
  state.optionDraftsDirty = true;
});

export const deleteOptionDraft = action('deleteOptionDraft', (key: string) => {
  replaceOptionDrafts(state.optionDrafts.filter(option => option.key !== key).map(cloneOption));
  state.optionDraftsDirty = true;
});

export const cropDraftName = action('cropDraftName', (currentName: string, nextName: string) => {
  const trimmedName = nextName.trim();
  if (!trimmedName) {
    snackbarMessage('Crop name cannot be empty');
    return;
  }
  if (state.cropDrafts.find(crop => normalizeFieldReference(crop.name) === normalizeFieldReference(trimmedName) && crop.name !== currentName)) {
    snackbarMessage('Crop name already exists');
    return;
  }

  const nextDrafts = state.cropDrafts.map((crop) => {
    if (crop.name !== currentName) {
      return crop;
    }
    return {
      ...cloneCrop(crop),
      name: trimmedName,
    };
  });

  replaceCropDrafts(nextDrafts);
  state.selectedCropName = trimmedName;
  state.cropDraftsDirty = true;
});

export const cropDraftTemplate = action('cropDraftTemplate', (cropName: string, isTemplate: boolean) => {
  replaceCropDrafts(state.cropDrafts.map((crop) => {
    if (crop.name !== cropName) {
      return crop;
    }
    return {
      ...cloneCrop(crop),
      isTemplate,
    };
  }));
  state.cropDraftsDirty = true;
});

export const toggleCropDraftField = action('toggleCropDraftField', (cropName: string, fieldName: string) => {
  const nextDrafts = state.cropDrafts.map((crop) => {
    if (crop.name !== cropName) {
      return crop;
    }

    const hasField = crop.fieldNames.some(name => normalizeFieldReference(name) === normalizeFieldReference(fieldName));
    const fieldNames = hasField
      ? crop.fieldNames.filter(name => normalizeFieldReference(name) !== normalizeFieldReference(fieldName))
      : sortStrings([ ...crop.fieldNames, fieldName ]);

    return {
      ...cloneCrop(crop),
      fieldNames,
    };
  });

  replaceCropDrafts(nextDrafts);
  state.cropDraftsDirty = true;
});

export const applyCropTemplate = action('applyCropTemplate', (cropName: string, templateCropName: string, inverse: boolean) => {
  const templateCrop = state.cropDrafts.find(crop => crop.name === templateCropName) || null;
  if (!templateCrop) {
    snackbarMessage('Select a crop/template first');
    return;
  }

  const templateFieldNames = new Set(templateCrop.fieldNames.map(normalizeFieldReference));
  const allFieldNames = sortStrings((state.board?.fields || []).map(field => field.name));
  const nextFieldNames = inverse
    ? allFieldNames.filter(fieldName => !templateFieldNames.has(normalizeFieldReference(fieldName)))
    : sortStrings([ ...templateCrop.fieldNames ]);

  replaceCropDrafts(state.cropDrafts.map((crop) => {
    if (crop.name !== cropName) {
      return crop;
    }
    return {
      ...cloneCrop(crop),
      fieldNames: nextFieldNames,
    };
  }));
  state.cropDraftsDirty = true;
});

export const addCropDraft = action('addCropDraft', () => {
  const newCrop: EditableCrop = {
    name: nextNewCropName(),
    isTemplate: false,
    fieldNames: [],
  };
  replaceCropDrafts([ ...state.cropDrafts.map(cloneCrop), newCrop ]);
  state.selectedCropName = newCrop.name;
  state.cropDraftsDirty = true;
});

export const fieldDraftName = action('fieldDraftName', (currentName: string, nextName: string) => {
  const trimmedName = nextName.trim();
  if (!trimmedName) {
    snackbarMessage('Field name cannot be empty');
    return;
  }
  if (state.fieldDrafts.find(field => normalizeFieldReference(field.name) === normalizeFieldReference(trimmedName) && field.name !== currentName)) {
    snackbarMessage('Field name already exists');
    return;
  }
  const nextDrafts = state.fieldDrafts.map((field) => {
    if (field.name !== currentName) {
      return field;
    }
    return {
      ...cloneField(field),
      name: trimmedName,
    };
  });
  replaceFieldDrafts(nextDrafts);
  state.selectedManagerFieldName = trimmedName;
  state.fieldDraftsDirty = true;
});

export const fieldDraftAliases = action('fieldDraftAliases', (fieldName: string, aliasText: string) => {
  const aliases = aliasText
    .split(',')
    .map(alias => alias.trim())
    .filter(Boolean);
  const nextDrafts = state.fieldDrafts.map((field) => {
    if (field.name !== fieldName) {
      return field;
    }
    return {
      ...cloneField(field),
      aliases,
    };
  });
  replaceFieldDrafts(nextDrafts);
  state.fieldDraftsDirty = true;
});

export const fieldDraftAcreage = action('fieldDraftAcreage', (fieldName: string, acreage: number) => {
  const nextDrafts = state.fieldDrafts.map((field) => {
    if (field.name !== fieldName) {
      return field;
    }
    return {
      ...cloneField(field),
      acreage,
    };
  });
  replaceFieldDrafts(nextDrafts);
  state.fieldDraftsDirty = true;
});

export const fieldDraftBoundary = action('fieldDraftBoundary', (fieldName: string, boundary: FieldBoundary | null) => {
  const nextDrafts = state.fieldDrafts.map((field) => {
    if (field.name !== fieldName) {
      return field;
    }
    const nextField = cloneField(field);
    nextField.boundary = boundary;
    if (boundary && (!Number.isFinite(nextField.acreage) || nextField.acreage <= 0)) {
      nextField.acreage = defaultFieldAreaAcres({
        name: nextField.name,
        boundary,
      });
    }
    return nextField;
  });
  replaceFieldDrafts(nextDrafts);
  state.fieldDraftsDirty = true;
});

export const addFieldDraft = action('addFieldDraft', () => {
  const newField: EditableField = {
    name: nextNewFieldName(),
    aliases: [],
    acreage: 1,
    boundary: null,
  };
  replaceFieldDrafts([ ...state.fieldDrafts.map(cloneField), newField ]);
  state.selectedManagerFieldName = newField.name;
  state.fieldDraftsDirty = true;
});

export const deleteFieldDraft = action('deleteFieldDraft', (fieldName: string) => {
  const nextDrafts = state.fieldDrafts
    .filter(field => field.name !== fieldName)
    .map(cloneField);
  replaceFieldDrafts(nextDrafts);
  state.fieldDraftsDirty = true;
});

export const importKMZ = action('importKMZ', async (file: File) => {
  try {
    const importedFields = await parseKMZIntoEditableFields(file);
    const nextDrafts = state.fieldDrafts.map(cloneField);

    for (const importedField of importedFields) {
      const existing = nextDrafts.find(field => normalizeFieldReference(field.name) === normalizeFieldReference(importedField.name));
      if (existing) {
        existing.boundary = importedField.boundary;
        existing.acreage = importedField.acreage;
      } else {
        nextDrafts.push(importedField);
      }
    }
    runInAction(() => {
      replaceFieldDrafts(nextDrafts);
      state.selectedManagerFieldName = importedFields[0]?.name || state.selectedManagerFieldName;
      state.fieldDraftsDirty = true;
    });
    snackbarMessage(`Imported ${importedFields.length} field boundary${importedFields.length === 1 ? '' : 'ies'}`);
  } catch (error) {
    loadingError(`Unable to import KMZ: ${(error as Error).message}`);
  }
});

export const saveFieldDrafts = action('saveFieldDrafts', async () => {
  const invalidField = state.fieldDrafts.find(field => !field.boundary);
  if (invalidField) {
    snackbarMessage(`Field "${invalidField.name}" needs a boundary before saving`);
    return;
  }

  try {
    loading(true);
    const fields: FieldInput[] = state.fieldDrafts.map(field => ({
      cardId: field.cardId,
      name: field.name,
      aliases: field.aliases,
      acreage: field.acreage,
      boundary: field.boundary!,
    }));
    await saveFields({
      client: await trello(),
      fields,
    });
    runInAction(() => {
      state.fieldDraftsDirty = false;
    });
    await loadBoard(true);
    snackbarMessage('Fields saved');
  } catch (error) {
    loadingError(`Unable to save fields: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

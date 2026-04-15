import area from '@turf/area';
import debug from 'debug';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { client, type TrelloCard, type TrelloList } from '@aultfarms/trello';
import type { CompletionPair, CompletionRecord, CompletionValues, CropInput, CropList, FieldBoundary, FieldDefinition, FieldInput, FieldWorkBoard, OperationFieldInclusion, OperationFieldState, OperationList, OperationOption, OperationOptionInput } from './types.js';
import { fieldWorkTrelloConfig } from './types.js';

const info = debug('af/field-work:info');

type FieldReferenceIndex = {
  refs: Map<string, string>;
  conflicts: string[];
};

type ParsedCompletion = {
  date: string;
  fieldRef: string;
  rawPairs: CompletionPair[];
  values: CompletionValues;
};

type ParsedCompletionResult =
  | { type: 'completion'; completion: ParsedCompletion }
  | { type: 'ignore' };

type ParsedOperationCard =
  | { type: 'crops'; values: string[] }
  | { type: 'include'; values: string[] }
  | { type: 'exclude'; values: string[] }
  | { type: 'option'; option: { type: string; typeKey: string; name: string; description: string } }
  | ParsedCompletionResult;

let cachedBoard: FieldWorkBoard | null = null;
let cachedBoardName: string = fieldWorkTrelloConfig.board;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeFieldReference(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeCrop(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}
function parseCropListName(name: string): { crop: string; isTemplate: boolean } | null {
  const cropMatch = name.match(/^crop:\s*(.+)$/i);
  if (cropMatch) {
    return {
      crop: normalizeWhitespace(cropMatch[1] || ''),
      isTemplate: false,
    };
  }
  const templateMatch = name.match(/^template:\s*(.+)$/i);
  if (templateMatch) {
    return {
      crop: normalizeWhitespace(templateMatch[1] || ''),
      isTemplate: true,
    };
  }
  return null;
}

function cropListName(crop: string, isTemplate: boolean): string {
  return `${isTemplate ? fieldWorkTrelloConfig.templatePrefix : fieldWorkTrelloConfig.cropPrefix}${crop}`;
}

function sortCards(cards: TrelloCard[] | undefined): TrelloCard[] {
  return [ ...(cards || []) ].sort((left, right) => left.pos - right.pos);
}

function sortLists(lists: TrelloList[]): TrelloList[] {
  return [ ...lists ].sort((left, right) => (left.pos || 0) - (right.pos || 0));
}

function roundAcres(value: number): number {
  return Math.round(value * 100) / 100;
}

export function fieldBoundaryAreaAcres(boundary: FieldBoundary): number {
  return roundAcres(area(boundary) / 4046.8564224);
}

export function fieldNameAreaAcres(name: string): number | null {
  const match = normalizeWhitespace(name).match(/\d+/);
  if (!match) {
    return null;
  }

  const acreage = Number.parseInt(match[0], 10);
  if (!Number.isFinite(acreage) || acreage <= 0) {
    return null;
  }

  return roundAcres(acreage);
}

export function defaultFieldAreaAcres({ name, boundary }: { name: string; boundary: FieldBoundary }): number {
  return fieldNameAreaAcres(name) ?? fieldBoundaryAreaAcres(boundary);
}

function uniqueNormalizedValues(values: string[]): string[] {
  const seen = new Set<string>();
  const ret: string[] = [];
  for (const value of values) {
    const trimmed = normalizeWhitespace(value);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ret.push(trimmed);
  }
  return ret;
}

function sortStrings(values: string[]): string[] {
  return [ ...values ].sort((left, right) => left.localeCompare(right));
}

function isFieldBoundary(value: unknown): value is FieldBoundary {
  if (!value || typeof value !== 'object') return false;
  const feature = value as FieldBoundary;
  if (feature.type !== 'Feature') return false;
  if (!feature.geometry || typeof feature.geometry !== 'object') return false;
  return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon';
}

function stripBoundaryProperties(boundary: FieldBoundary): FieldBoundary {
  return {
    type: 'Feature',
    properties: null,
    geometry: boundary.geometry,
  };
}

function formatFieldCardMetadata(field: FieldInput): string {
  return stringifyYaml({
    aliases: uniqueNormalizedValues(field.aliases).filter(alias => normalizeFieldReference(alias) !== normalizeFieldReference(field.name)),
    boundary: stripBoundaryProperties(field.boundary),
    acreage: roundAcres(field.acreage),
  }, { lineWidth: 120 });
}

export function formatCompletionCard({ date, fieldName, values }: { date: string; fieldName: string; values: CompletionValues }): string {
  const normalizedPairs = Object.entries(values)
    .map(([ key, value ]) => [ normalizeWhitespace(key), normalizeWhitespace(value) ] as const)
    .filter(([ key, value ]) => !!key && !!value);
  const front = `${date}: ${fieldName}.`;
  if (normalizedPairs.length < 1) {
    return front;
  }
  const detail = normalizedPairs.map(([ key, value ]) => `${key}: ${value}`).join('; ');
  return `${front} ${detail}`;
}

function parseFrontKeyValuePairs(value: string): CompletionPair[] | null {
  if (!value.trim()) {
    return [];
  }
  const pairs: CompletionPair[] = [];
  for (const segment of value.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex < 1) {
      return null;
    }
    const key = normalizeWhitespace(trimmed.slice(0, colonIndex)).toLowerCase();
    const pairValue = normalizeWhitespace(trimmed.slice(colonIndex + 1));
    if (!key || !pairValue) {
      return null;
    }
    pairs.push({ key, value: pairValue });
  }
  return pairs;
}

function parseCompletionCardName(name: string): ParsedCompletionResult {
  const match = name.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+?)\.\s*(.*)$/);
  if (!match) {
    return { type: 'ignore' };
  }

  const date = match[1] || '';
  const fieldRef = normalizeWhitespace(match[2] || '');
  const tail = match[3] || '';
  if (!date || !fieldRef) {
    return { type: 'ignore' };
  }

  const rawPairs = parseFrontKeyValuePairs(tail);
  if (!rawPairs) {
    return { type: 'ignore' };
  }

  const values: CompletionValues = {};
  for (const pair of rawPairs) {
    values[pair.key] = pair.value;
  }

  return {
    type: 'completion',
    completion: {
      date,
      fieldRef,
      rawPairs,
      values,
    },
  };
}

function splitCommaSeparatedValues(value: string): string[] {
  return uniqueNormalizedValues(value.split(','));
}

function formatOptionCard({ type, name, description }: OperationOptionInput): string {
  const trimmedType = normalizeWhitespace(type);
  const trimmedName = normalizeWhitespace(name);
  const trimmedDescription = normalizeWhitespace(description);
  return `OPTION: ${trimmedType} - ${trimmedName}${trimmedDescription ? `. ${trimmedDescription}` : ''}`;
}

function formatCommaSeparatedCard(prefix: 'CROPS' | 'INCLUDE' | 'EXCLUDE', values: string[]): string {
  return `${prefix}: ${values.join(', ')}`;
}

function parseOptionCard(name: string): ParsedOperationCard | null {
  if (!name.toUpperCase().startsWith('OPTION:')) {
    return null;
  }
  const body = name.slice('OPTION:'.length).trim();
  const dashIndex = body.indexOf('-');
  if (dashIndex < 1) {
    return null;
  }
  const type = normalizeWhitespace(body.slice(0, dashIndex));
  const rest = body.slice(dashIndex + 1).trim();
  if (!type || !rest) {
    return null;
  }
  const periodIndex = rest.indexOf('.');
  const optionName = normalizeWhitespace(periodIndex >= 0 ? rest.slice(0, periodIndex) : rest);
  const description = normalizeWhitespace(periodIndex >= 0 ? rest.slice(periodIndex + 1) : '');
  if (!optionName) {
    return null;
  }
  return {
    type: 'option',
    option: {
      type,
      typeKey: type.toLowerCase(),
      name: optionName,
      description,
    },
  };
}

function parseOperationCard(card: TrelloCard): ParsedOperationCard {
  const upper = card.name.toUpperCase();
  if (upper.startsWith('CROPS:')) {
    return { type: 'crops', values: splitCommaSeparatedValues(card.name.slice('CROPS:'.length)) };
  }
  if (upper.startsWith('INCLUDE:')) {
    return { type: 'include', values: splitCommaSeparatedValues(card.name.slice('INCLUDE:'.length)) };
  }
  if (upper.startsWith('EXCLUDE:')) {
    return { type: 'exclude', values: splitCommaSeparatedValues(card.name.slice('EXCLUDE:'.length)) };
  }
  const option = parseOptionCard(card.name);
  if (option) {
    return option;
  }
  return parseCompletionCardName(card.name);
}

function buildFieldReferenceIndex(fields: FieldDefinition[]): FieldReferenceIndex {
  const refs = new Map<string, string>();
  const conflicts: string[] = [];

  for (const field of fields) {
    const candidates = [ field.name, ...field.aliases ];
    for (const candidate of candidates) {
      const key = normalizeFieldReference(candidate);
      if (!key) continue;
      const existing = refs.get(key);
      if (existing && existing !== field.name) {
        conflicts.push(`Field reference "${candidate}" is ambiguous between "${existing}" and "${field.name}"`);
        continue;
      }
      refs.set(key, field.name);
    }
  }

  return { refs, conflicts };
}

function resolveFieldReference(reference: string, fieldReferences: FieldReferenceIndex): string | null {
  return fieldReferences.refs.get(normalizeFieldReference(reference)) || null;
}

function sortFields(fields: FieldDefinition[]): FieldDefinition[] {
  return [ ...fields ].sort((left, right) => left.name.localeCompare(right.name));
}

function parseFieldCard(card: TrelloCard): FieldDefinition {
  let raw: Partial<FieldDefinition> & Partial<{ aliases: unknown; boundary: unknown; acreage: unknown }> = {};
  if (card.desc.trim()) {
    try {
      const parsed = parseYaml(card.desc);
      raw = parsed && typeof parsed === 'object'
        ? parsed as typeof raw
        : {};
    } catch (error) {
      throw new Error(`Field "${card.name}" description is not valid YAML: ${(error as Error).message}`);
    }
  }

  if (!isFieldBoundary(raw.boundary)) {
    throw new Error(`Field "${card.name}" does not contain a valid GeoJSON boundary in card description`);
  }

  const boundary = stripBoundaryProperties(raw.boundary);

  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter((alias): alias is string => typeof alias === 'string')
    : [];
  const cleanedAliases = uniqueNormalizedValues(aliases).filter(alias => normalizeFieldReference(alias) !== normalizeFieldReference(card.name));
  const acreage = typeof raw.acreage === 'number' && Number.isFinite(raw.acreage)
    ? roundAcres(raw.acreage)
    : defaultFieldAreaAcres({ name: card.name, boundary });

  return {
    cardId: card.id,
    cardName: card.name,
    cardDesc: card.desc,
    dateLastActivity: card.dateLastActivity,
    name: card.name,
    aliases: cleanedAliases,
    boundary,
    acreage,
  };
}

function toFieldMap(fields: FieldDefinition[]): Map<string, FieldDefinition> {
  return new Map(fields.map(field => [ field.name, field ]));
}

function toFieldStateMap(fieldStates: OperationList['fieldStates']): OperationList['fieldStateByName'] {
  return Object.fromEntries(fieldStates.map(fieldState => [ fieldState.field.name, fieldState ]));
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return roundAcres((part / total) * 100);
}

function newestCompletion(left: CompletionRecord, right: CompletionRecord): CompletionRecord {
  return left.dateLastActivity >= right.dateLastActivity ? left : right;
}

function buildOperationList({
  list,
  fields,
  cropLists,
  fieldReferences,
}: {
  list: TrelloList;
  fields: FieldDefinition[];
  cropLists: CropList[];
  fieldReferences: FieldReferenceIndex;
}): OperationList {
  const cards = sortCards(list.cards);
  const fieldMap = toFieldMap(fields);
  const errors: string[] = [];
  const unresolvedRefs: string[] = [];
  const ignoredCards: TrelloCard[] = [];
  const completions: CompletionRecord[] = [];
  const metadata = {
    crops: [] as string[],
    include: [] as string[],
    exclude: [] as string[],
    optionsByType: {} as Record<string, OperationOption[]>,
  };
  const metadataCards = {
    crops: [] as TrelloCard[],
    include: [] as TrelloCard[],
    exclude: [] as TrelloCard[],
    options: [] as TrelloCard[],
  };

  for (const card of cards) {
    const parsed = parseOperationCard(card);
    if (parsed.type === 'crops') {
      metadataCards.crops.push(card);
      metadata.crops = uniqueNormalizedValues([ ...metadata.crops, ...parsed.values ]);
      continue;
    }
    if (parsed.type === 'include') {
      metadataCards.include.push(card);
      for (const rawReference of parsed.values) {
        const resolved = resolveFieldReference(rawReference, fieldReferences);
        if (!resolved) {
          unresolvedRefs.push(rawReference);
          continue;
        }
        metadata.include = uniqueNormalizedValues([ ...metadata.include, resolved ]);
      }
      continue;
    }
    if (parsed.type === 'exclude') {
      metadataCards.exclude.push(card);
      for (const rawReference of parsed.values) {
        const resolved = resolveFieldReference(rawReference, fieldReferences);
        if (!resolved) {
          unresolvedRefs.push(rawReference);
          continue;
        }
        metadata.exclude = uniqueNormalizedValues([ ...metadata.exclude, resolved ]);
      }
      continue;
    }
    if (parsed.type === 'option') {
      metadataCards.options.push(card);
      const options = metadata.optionsByType[parsed.option.typeKey] || [];
      options.push({
        cardId: card.id,
        type: parsed.option.type,
        typeKey: parsed.option.typeKey,
        name: parsed.option.name,
        description: parsed.option.description,
      });
      metadata.optionsByType[parsed.option.typeKey] = options;
      continue;
    }
    if (parsed.type === 'ignore') {
      ignoredCards.push(card);
      continue;
    }

    const resolvedField = resolveFieldReference(parsed.completion.fieldRef, fieldReferences);
    if (!resolvedField) {
      errors.push(`Unable to resolve field reference "${parsed.completion.fieldRef}" in operation "${list.name}"`);
      continue;
    }

    completions.push({
      cardId: card.id,
      idList: card.idList,
      cardName: card.name,
      dateLastActivity: card.dateLastActivity,
      date: parsed.completion.date,
      fieldName: resolvedField,
      fieldRef: parsed.completion.fieldRef,
      values: parsed.completion.values,
      rawPairs: parsed.completion.rawPairs,
      note: parsed.completion.values.note || '',
    });
  }

  for (const optionGroup of Object.values(metadata.optionsByType)) {
    optionGroup.sort((left, right) => left.name.localeCompare(right.name));
  }

  const eligibleFields = new Set<string>();
  const includedBy = new Map<string, OperationFieldInclusion>();

  if (metadata.crops.length > 0) {
    const cropMap = new Map(cropLists.map(cropList => [ normalizeCrop(cropList.crop), cropList ]));
    for (const cropName of metadata.crops) {
      const cropList = cropMap.get(normalizeCrop(cropName));
      if (!cropList) {
        errors.push(`Operation \"${list.name}\" references missing crop/template \"${cropName}\"`);
        continue;
      }
      for (const fieldName of cropList.fieldNames) {
        eligibleFields.add(fieldName);
        if (!includedBy.has(fieldName)) {
          includedBy.set(fieldName, 'crop');
        }
      }
    }
  } else {
    for (const field of fields) {
      eligibleFields.add(field.name);
      includedBy.set(field.name, 'all');
    }
  }

  for (const fieldName of metadata.include) {
    eligibleFields.add(fieldName);
    includedBy.set(fieldName, 'include');
  }

  const excluded = new Set<string>();
  for (const fieldName of metadata.exclude) {
    eligibleFields.delete(fieldName);
    excluded.add(fieldName);
  }

  const newestCompletions = new Map<string, CompletionRecord>();
  for (const completion of completions) {
    const existing = newestCompletions.get(completion.fieldName);
    newestCompletions.set(
      completion.fieldName,
      existing ? newestCompletion(existing, completion) : completion,
    );
  }

  const fieldStates: OperationFieldState[] = sortFields(fields).map((field) => {
    const eligible = eligibleFields.has(field.name);
    const completion = eligible ? (newestCompletions.get(field.name) || null) : null;
    const status: OperationFieldState['status'] = completion ? 'completed' : eligible ? 'planned' : 'ineligible';
    return {
      field,
      status,
      includedBy: eligible ? (includedBy.get(field.name) || 'all') : null,
      excluded: excluded.has(field.name),
      completion,
    };
  });

  const completedFieldNames = fieldStates.filter(fieldState => fieldState.status === 'completed').map(fieldState => fieldState.field.name);
  const plannedFieldNames = fieldStates.filter(fieldState => fieldState.status === 'planned').map(fieldState => fieldState.field.name);
  const eligibleFieldNames = fieldStates.filter(fieldState => fieldState.status !== 'ineligible').map(fieldState => fieldState.field.name);
  const totalAcres = fieldStates
    .filter(fieldState => fieldState.status !== 'ineligible')
    .reduce((sum, fieldState) => sum + fieldState.field.acreage, 0);
  const completedAcres = fieldStates
    .filter(fieldState => fieldState.status === 'completed')
    .reduce((sum, fieldState) => sum + fieldState.field.acreage, 0);
  const plannedAcres = fieldStates
    .filter(fieldState => fieldState.status === 'planned')
    .reduce((sum, fieldState) => sum + fieldState.field.acreage, 0);

  const visibleCompletions = [ ...newestCompletions.values() ]
    .filter(completion => eligibleFields.has(completion.fieldName))
    .sort((left, right) => left.fieldName.localeCompare(right.fieldName));

  return {
    idList: list.id,
    name: list.name,
    cards,
    metadata: {
      crops: sortStrings(metadata.crops),
      include: sortStrings(metadata.include),
      exclude: sortStrings(metadata.exclude),
      optionsByType: metadata.optionsByType,
    },
    metadataCards,
    completions: visibleCompletions,
    ignoredCards,
    unresolvedRefs: sortStrings(uniqueNormalizedValues(unresolvedRefs)),
    errors,
    fieldStates,
    fieldStateByName: toFieldStateMap(fieldStates),
    eligibleFieldNames,
    completedFieldNames,
    plannedFieldNames,
    acreage: {
      total: roundAcres(totalAcres),
      completed: roundAcres(completedAcres),
      planned: roundAcres(plannedAcres),
      completedPercent: percent(completedAcres, totalAcres),
      plannedPercent: percent(plannedAcres, totalAcres),
    },
  };
}

function parseBoard(boardId: string, boardName: string, lists: TrelloList[]): FieldWorkBoard {
  const sortedLists = sortLists(lists).map(list => ({
    ...list,
    cards: sortCards(list.cards),
  }));
  const errors: string[] = [];
  const warnings: string[] = [];

  const fieldsList = sortedLists.find(list => list.name === fieldWorkTrelloConfig.fieldsList);
  if (!fieldsList) {
    throw new Error('Field Work board is missing the Fields list');
  }

  const fields: FieldDefinition[] = [];
  for (const card of sortCards(fieldsList.cards)) {
    try {
      fields.push(parseFieldCard(card));
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  const sortedFields = sortFields(fields);
  const fieldReferences = buildFieldReferenceIndex(sortedFields);
  errors.push(...fieldReferences.conflicts);

  const cropLists = sortedLists.reduce<CropList[]>((ret, list) => {
      const cropInfo = parseCropListName(list.name);
      if (!cropInfo) {
        return ret;
      }
      const fieldNames: string[] = [];
      const unresolvedRefs: string[] = [];

      for (const card of sortCards(list.cards)) {
        const resolved = resolveFieldReference(card.name, fieldReferences);
        if (!resolved) {
          unresolvedRefs.push(card.name);
          continue;
        }
        fieldNames.push(resolved);
      }

      ret.push({
        idList: list.id,
        name: list.name,
        crop: cropInfo.crop,
        isTemplate: cropInfo.isTemplate,
        fieldNames: sortStrings(uniqueNormalizedValues(fieldNames)),
        unresolvedRefs: sortStrings(uniqueNormalizedValues(unresolvedRefs)),
        cards: sortCards(list.cards),
      });
      return ret;
    }, []);

  for (const cropList of cropLists) {
    if (cropList.unresolvedRefs.length > 0) {
      warnings.push(`Crop/template list \"${cropList.name}\" contains unresolved field references: ${cropList.unresolvedRefs.join(', ')}`);
    }
  }

  const operations = sortedLists
    .filter(list => list.name !== fieldWorkTrelloConfig.fieldsList)
    .filter(list => !parseCropListName(list.name))
    .map(list => buildOperationList({
      list,
      fields: sortedFields,
      cropLists,
      fieldReferences,
    }));

  for (const operation of operations) {
    errors.push(...operation.errors);
    if (operation.unresolvedRefs.length > 0) {
      warnings.push(`Operation "${operation.name}" contains unresolved field references: ${operation.unresolvedRefs.join(', ')}`);
    }
  }

  return {
    boardId,
    boardName,
    fieldsListId: fieldsList.id,
    fields: sortedFields,
    cropLists,
    operations,
    errors: sortStrings(uniqueNormalizedValues(errors)),
    warnings: sortStrings(uniqueNormalizedValues(warnings)),
  };
}

async function fetchLists({ client, boardId }: { client: client.Client; boardId: string }): Promise<TrelloList[]> {
  return client.findListsAndCardsOnBoard({ boardid: boardId });
}

async function ensureFieldsList({ client, boardId, lists }: { client: client.Client; boardId: string; lists: TrelloList[] }): Promise<TrelloList[]> {
  if (lists.find(list => list.name === fieldWorkTrelloConfig.fieldsList)) {
    return lists;
  }
  info('Creating missing Fields list on Field Work board');
  await client.post(`/boards/${boardId}/lists`, { name: fieldWorkTrelloConfig.fieldsList, pos: 'top' });
  return fetchLists({ client, boardId });
}

export async function fieldWorkBoard({ client, name, force }: { client: client.Client; name?: string; force?: true }): Promise<FieldWorkBoard> {
  if (!cachedBoard || force || (name && name !== cachedBoardName)) {
    cachedBoardName = name || cachedBoardName;
    const boardId = await client.findBoardidByName(cachedBoardName);
    let lists = await fetchLists({ client, boardId });
    lists = await ensureFieldsList({ client, boardId, lists });
    cachedBoard = parseBoard(boardId, cachedBoardName, lists);
  }

  return cachedBoard;
}

function validateFieldInputs(fields: FieldInput[]): void {
  const cleanedFields = fields.map(field => ({
    ...field,
    name: normalizeWhitespace(field.name),
    aliases: uniqueNormalizedValues(field.aliases).filter(alias => normalizeFieldReference(alias) !== normalizeFieldReference(field.name)),
    acreage: roundAcres(field.acreage),
  }));

  for (const field of cleanedFields) {
    if (!field.name) {
      throw new Error('Every field must have a name');
    }
    if (!isFieldBoundary(field.boundary)) {
      throw new Error(`Field "${field.name}" must have a valid boundary`);
    }
    if (!Number.isFinite(field.acreage) || field.acreage <= 0) {
      throw new Error(`Field "${field.name}" must have a positive acreage`);
    }
  }

  const refs = buildFieldReferenceIndex(cleanedFields.map(field => ({
    cardId: field.cardId || '',
    cardName: field.name,
    cardDesc: '',
    dateLastActivity: '',
    name: field.name,
    aliases: field.aliases,
    boundary: field.boundary,
    acreage: field.acreage,
  })));
  if (refs.conflicts.length > 0) {
    throw new Error(refs.conflicts[0] || 'Field names or aliases conflict');
  }
}

function validateOperationName({
  name,
  board,
  currentOperationIdList,
}: {
  name: string;
  board: FieldWorkBoard;
  currentOperationIdList?: string;
}): string {
  const trimmedName = normalizeWhitespace(name);
  if (!trimmedName) {
    throw new Error('Operation name cannot be empty');
  }
  if (trimmedName === fieldWorkTrelloConfig.fieldsList) {
    throw new Error(`Operation name cannot be "${fieldWorkTrelloConfig.fieldsList}"`);
  }
  if (parseCropListName(trimmedName)) {
    throw new Error('Operation name cannot look like a crop/template list');
  }

  const conflict = board.operations.find(operation =>
    normalizeFieldReference(operation.name) === normalizeFieldReference(trimmedName)
    && operation.idList !== currentOperationIdList,
  );
  if (conflict) {
    throw new Error(`Operation "${trimmedName}" already exists`);
  }

  return trimmedName;
}

function validateCropInputs(crops: CropInput[], fields: FieldDefinition[]): CropInput[] {
  const fieldNamesByKey = new Map(fields.map(field => [ normalizeFieldReference(field.name), field.name ]));
  const seenCropNames = new Set<string>();

  return crops.map((crop) => {
    const name = normalizeWhitespace(crop.name);
    if (!name) {
      throw new Error('Every crop must have a name');
    }

    const cropKey = normalizeCrop(name);
    if (seenCropNames.has(cropKey)) {
      throw new Error(`Crop "${name}" already exists`);
    }
    seenCropNames.add(cropKey);

    const seenFieldNames = new Set<string>();
    const fieldNames: string[] = [];
    for (const rawFieldName of crop.fieldNames) {
      const resolvedFieldName = fieldNamesByKey.get(normalizeFieldReference(rawFieldName));
      if (!resolvedFieldName) {
        throw new Error(`Crop "${name}" references unknown field "${rawFieldName}"`);
      }
      const fieldKey = normalizeFieldReference(resolvedFieldName);
      if (seenFieldNames.has(fieldKey)) {
        continue;
      }
      seenFieldNames.add(fieldKey);
      fieldNames.push(resolvedFieldName);
    }

    return {
      idList: crop.idList,
      name,
      isTemplate: !!crop.isTemplate,
      fieldNames: sortStrings(fieldNames),
    };
  });
}

async function archiveCard({ client, cardId }: { client: client.Client; cardId: string }): Promise<void> {
  await client.put(`/cards/${cardId}`, { closed: true });
}

async function syncCropListCards({
  client,
  idList,
  cards,
  fieldNames,
}: {
  client: client.Client;
  idList: string;
  cards: TrelloCard[] | undefined;
  fieldNames: string[];
}): Promise<void> {
  const remainingCards = new Map<string, TrelloCard>();
  const extraCards: TrelloCard[] = [];

  for (const card of sortCards(cards)) {
    const key = normalizeFieldReference(card.name);
    if (!key || remainingCards.has(key)) {
      extraCards.push(card);
      continue;
    }
    remainingCards.set(key, card);
  }

  for (const fieldName of sortStrings(uniqueNormalizedValues(fieldNames))) {
    const key = normalizeFieldReference(fieldName);
    const existingCard = remainingCards.get(key);
    if (existingCard) {
      if (existingCard.name !== fieldName) {
        await client.put(`/cards/${existingCard.id}`, { name: fieldName });
      }
      remainingCards.delete(key);
      continue;
    }

    await client.post('/cards', {
      idList,
      name: fieldName,
      pos: 'bottom',
    });
  }

  for (const card of [ ...remainingCards.values(), ...extraCards ]) {
    await archiveCard({ client, cardId: card.id });
  }
}

export async function saveFields({ client, fields }: { client: client.Client; fields: FieldInput[] }): Promise<void> {
  validateFieldInputs(fields);

  const board = await fieldWorkBoard({ client, force: true });
  const nextFields = sortStrings(fields.map(field => field.name));
  const nextById = new Map(fields.filter(field => !!field.cardId).map(field => [ field.cardId!, field ]));
  const nextByName = new Map(fields.map(field => [ normalizeFieldReference(field.name), field ]));
  const currentById = new Map(board.fields.map(field => [ field.cardId, field ]));

  for (const currentField of board.fields) {
    const keepById = nextById.has(currentField.cardId);
    const keepByName = nextByName.has(normalizeFieldReference(currentField.name));
    if (keepById || keepByName) {
      continue;
    }
    await archiveCard({ client, cardId: currentField.cardId });
  }

  for (const inputField of fields) {
    const matchedCurrent = inputField.cardId
      ? currentById.get(inputField.cardId) || null
      : board.fields.find(field => normalizeFieldReference(field.name) === normalizeFieldReference(inputField.name)) || null;
    const name = normalizeWhitespace(inputField.name);
    const desc = formatFieldCardMetadata({
      ...inputField,
      name,
      aliases: uniqueNormalizedValues(inputField.aliases),
      acreage: roundAcres(inputField.acreage),
    });

    if (matchedCurrent) {
      await client.put(`/cards/${matchedCurrent.cardId}`, { name, desc });
      continue;
    }

    await client.post('/cards', {
      idList: board.fieldsListId,
      name,
      desc,
      pos: 'bottom',
    });
  }

  cachedBoard = null;
  if (nextFields.length > 0) {
    info('Saved %d fields', nextFields.length);
  }
}

export async function saveCropLists({ client, crops }: { client: client.Client; crops: CropInput[] }): Promise<void> {
  const board = await fieldWorkBoard({ client, force: true });
  const nextCrops = validateCropInputs(crops, board.fields);
  const currentById = new Map(board.cropLists.map(crop => [ crop.idList, crop ]));
  const currentByName = new Map(board.cropLists.map(crop => [ normalizeCrop(crop.crop), crop ]));

  for (const crop of nextCrops) {
    const matchedCurrent = crop.idList
      ? currentById.get(crop.idList) || null
      : currentByName.get(normalizeCrop(crop.name)) || null;
    let idList = matchedCurrent?.idList || '';
    const name = cropListName(crop.name, crop.isTemplate);

    if (matchedCurrent) {
      if (matchedCurrent.name !== name) {
        await client.put(`/lists/${matchedCurrent.idList}`, { name });
      }
      idList = matchedCurrent.idList;
    } else {
      const createdLists = await client.post(`/boards/${board.boardId}/lists`, { name, pos: 'bottom' });
      const createdListId = createdLists[0]?.id;
      if (typeof createdListId !== 'string' || !createdListId) {
        throw new Error(`Unable to create crop list "${crop.name}"`);
      }
      idList = createdListId;
    }

    await syncCropListCards({
      client,
      idList,
      cards: matchedCurrent?.cards,
      fieldNames: crop.fieldNames,
    });
  }

  cachedBoard = null;
}

function validateOperationOptionInputs(options: OperationOptionInput[]): OperationOptionInput[] {
  const seenOptions = new Set<string>();

  return options.map((option) => {
    const type = normalizeWhitespace(option.type);
    const name = normalizeWhitespace(option.name);
    const description = normalizeWhitespace(option.description);
    if (!type) {
      throw new Error('Every option must have a type');
    }
    if (!name) {
      throw new Error('Every option must have a name');
    }

    const optionKey = `${type.toLowerCase()}:${name.toLowerCase()}`;
    if (seenOptions.has(optionKey)) {
      throw new Error(`Option "${type} - ${name}" already exists`);
    }
    seenOptions.add(optionKey);

    return {
      cardId: option.cardId,
      type,
      name,
      description,
    };
  });
}

export async function saveOperationOptions({
  client,
  operation,
  options,
}: {
  client: client.Client;
  operation: OperationList;
  options: OperationOptionInput[];
}): Promise<void> {
  const nextOptions = validateOperationOptionInputs(options);
  const nextById = new Map(nextOptions.filter(option => !!option.cardId).map(option => [ option.cardId!, option ]));

  for (const card of operation.metadataCards.options) {
    if (!nextById.has(card.id)) {
      await archiveCard({ client, cardId: card.id });
    }
  }

  for (const option of nextOptions) {
    const name = formatOptionCard(option);
    if (option.cardId) {
      await client.put(`/cards/${option.cardId}`, { name });
      continue;
    }

    await client.post('/cards', {
      idList: operation.idList,
      name,
      pos: 'bottom',
    });
  }

  cachedBoard = null;
}


async function upsertCommaSeparatedMetadataCard({
  client,
  idList,
  cards,
  prefix,
  values,
}: {
  client: client.Client;
  idList: string;
  cards: TrelloCard[];
  prefix: 'CROPS' | 'INCLUDE' | 'EXCLUDE';
  values: string[];
}): Promise<void> {
  const nextValues = sortStrings(uniqueNormalizedValues(values));
  const [ primary, ...rest ] = cards;

  if (nextValues.length < 1) {
    for (const card of cards) {
      await archiveCard({ client, cardId: card.id });
    }
    cachedBoard = null;
    return;
  }

  const name = formatCommaSeparatedCard(prefix, nextValues);
  if (primary) {
    await client.put(`/cards/${primary.id}`, { name });
  } else {
    await client.post('/cards', {
      idList,
      name,
      pos: 'bottom',
    });
  }

  for (const extraCard of rest) {
    await archiveCard({ client, cardId: extraCard.id });
  }

  cachedBoard = null;
}

async function upsertFieldReferenceCard({
  client,
  operation,
  prefix,
  values,
}: {
  client: client.Client;
  operation: OperationList;
  prefix: 'INCLUDE' | 'EXCLUDE';
  values: string[];
}): Promise<void> {
  await upsertCommaSeparatedMetadataCard({
    client,
    idList: operation.idList,
    cards: prefix === 'INCLUDE' ? operation.metadataCards.include : operation.metadataCards.exclude,
    prefix,
    values,
  });
}

export async function saveOperationCropFilter({
  client,
  operation,
  cropNames,
}: {
  client: client.Client;
  operation: OperationList;
  cropNames: string[];
}): Promise<void> {
  await upsertCommaSeparatedMetadataCard({
    client,
    idList: operation.idList,
    cards: operation.metadataCards.crops,
    prefix: 'CROPS',
    values: cropNames,
  });
}

export async function saveOperationDefinition({
  client,
  operation,
  name,
  cropNames,
}: {
  client: client.Client;
  operation?: OperationList;
  name: string;
  cropNames: string[];
}): Promise<{ name: string; idList: string }> {
  const board = await fieldWorkBoard({ client, force: true });
  const validatedName = validateOperationName({
    name,
    board,
    currentOperationIdList: operation?.idList,
  });
  let idList = operation?.idList || '';

  if (operation) {
    if (operation.name !== validatedName) {
      await client.put(`/lists/${operation.idList}`, { name: validatedName });
    }
    idList = operation.idList;
  } else {
    const createdLists = await client.post(`/boards/${board.boardId}/lists`, { name: validatedName, pos: 'bottom' });
    const createdListId = createdLists[0]?.id;
    if (typeof createdListId !== 'string' || !createdListId) {
      throw new Error(`Unable to create operation "${validatedName}"`);
    }
    idList = createdListId;
  }

  await upsertCommaSeparatedMetadataCard({
    client,
    idList,
    cards: operation?.metadataCards.crops || [],
    prefix: 'CROPS',
    values: cropNames,
  });

  cachedBoard = null;
  return {
    name: validatedName,
    idList,
  };
}

export async function addFieldToOperationInclude({
  client,
  operation,
  fieldName,
}: {
  client: client.Client;
  operation: OperationList;
  fieldName: string;
}): Promise<void> {
  await upsertFieldReferenceCard({
    client,
    operation,
    prefix: 'INCLUDE',
    values: [ ...operation.metadata.include, fieldName ],
  });
}

export async function addFieldToOperationExclude({
  client,
  operation,
  fieldName,
}: {
  client: client.Client;
  operation: OperationList;
  fieldName: string;
}): Promise<void> {
  await upsertFieldReferenceCard({
    client,
    operation,
    prefix: 'EXCLUDE',
    values: [ ...operation.metadata.exclude, fieldName ],
  });
}

export async function removeFieldFromOperationExclude({
  client,
  operation,
  fieldName,
}: {
  client: client.Client;
  operation: OperationList;
  fieldName: string;
}): Promise<void> {
  await upsertFieldReferenceCard({
    client,
    operation,
    prefix: 'EXCLUDE',
    values: operation.metadata.exclude.filter(name => normalizeFieldReference(name) !== normalizeFieldReference(fieldName)),
  });
}

export async function saveOperationCompletion({
  client,
  operation,
  fieldName,
  date,
  values,
}: {
  client: client.Client;
  operation: OperationList;
  fieldName: string;
  date: string;
  values: CompletionValues;
}): Promise<void> {
  await client.post('/cards', {
    idList: operation.idList,
    name: formatCompletionCard({ date, fieldName, values }),
    pos: 'bottom',
  });
  cachedBoard = null;
}

export async function deleteOperationCompletion({
  client,
  completionCardId,
}: {
  client: client.Client;
  completionCardId: string;
}): Promise<void> {
  await archiveCard({ client, cardId: completionCardId });
  cachedBoard = null;
}

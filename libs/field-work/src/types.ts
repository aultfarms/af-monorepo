import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { TrelloCard } from '@aultfarms/trello';

export const fieldWorkTrelloConfig = {
  board: 'Field Work',
  fieldsList: 'Fields',
  cropPrefix: 'Crop: ',
  templatePrefix: 'Template: ',
} as const;

export type FieldBoundary = Feature<Polygon | MultiPolygon>;
export type CompletionValues = Record<string, string>;

export type FieldCardMetadata = {
  aliases: string[];
  boundary: FieldBoundary;
  acreage: number;
};

export type FieldDefinition = FieldCardMetadata & {
  cardId: string;
  cardName: string;
  cardDesc: string;
  dateLastActivity: string;
  name: string;
};

export type FieldInput = {
  cardId?: string;
  name: string;
  aliases: string[];
  boundary: FieldBoundary;
  acreage: number;
};

export type CropList = {
  idList: string;
  name: string;
  crop: string;
  isTemplate: boolean;
  fieldNames: string[];
  unresolvedRefs: string[];
  cards: TrelloCard[];
};

export type CropInput = {
  idList?: string;
  name: string;
  isTemplate: boolean;
  fieldNames: string[];
};

export type OperationOption = {
  cardId: string;
  type: string;
  typeKey: string;
  name: string;
  description: string;
};

export type OperationOptionInput = {
  cardId?: string;
  type: string;
  name: string;
  description: string;
};

export type CompletionPair = {
  key: string;
  value: string;
};

export type CompletionRecord = {
  cardId: string;
  idList: string;
  cardName: string;
  dateLastActivity: string;
  date: string;
  fieldName: string;
  fieldRef: string;
  values: CompletionValues;
  rawPairs: CompletionPair[];
  note: string;
};

export type OperationMetadata = {
  crops: string[];
  include: string[];
  exclude: string[];
  optionsByType: Record<string, OperationOption[]>;
};

export type OperationFieldInclusion = 'all' | 'crop' | 'include' | null;

export type OperationFieldState = {
  field: FieldDefinition;
  status: 'planned' | 'completed' | 'ineligible';
  includedBy: OperationFieldInclusion;
  excluded: boolean;
  completion: CompletionRecord | null;
};

export type OperationList = {
  idList: string;
  name: string;
  cards: TrelloCard[];
  metadata: OperationMetadata;
  metadataCards: {
    crops: TrelloCard[];
    include: TrelloCard[];
    exclude: TrelloCard[];
    options: TrelloCard[];
  };
  completions: CompletionRecord[];
  ignoredCards: TrelloCard[];
  unresolvedRefs: string[];
  errors: string[];
  fieldStates: OperationFieldState[];
  fieldStateByName: Record<string, OperationFieldState>;
  eligibleFieldNames: string[];
  completedFieldNames: string[];
  plannedFieldNames: string[];
  acreage: {
    total: number;
    completed: number;
    planned: number;
    completedPercent: number;
    plannedPercent: number;
  };
};

export type FieldWorkBoard = {
  boardId: string;
  boardName: string;
  fieldsListId: string;
  fields: FieldDefinition[];
  cropLists: CropList[];
  operations: OperationList[];
  errors: string[];
  warnings: string[];
};

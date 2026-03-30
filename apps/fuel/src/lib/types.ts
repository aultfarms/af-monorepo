export type FuelSettingsGroupRow = {
  id: string;
  name: string;
  print: boolean;
};

export type FuelSettingsPersonRow = {
  id: string;
  name: string;
  group: string;
};

export type FuelSettingsVehicleRow = {
  id: string;
  name: string;
  group: string;
};

export type FuelSettingsPumpRow = {
  id: string;
  name: string;
};

export type FuelSettings = {
  spreadsheetId: string;
  spreadsheetPath: string;
  spreadsheetUrl: string;
  groups: FuelSettingsGroupRow[];
  groupsById: Record<string, FuelSettingsGroupRow>;
  people: FuelSettingsPersonRow[];
  peopleById: Record<string, FuelSettingsPersonRow>;
  vehicles: FuelSettingsVehicleRow[];
  vehiclesById: Record<string, FuelSettingsVehicleRow>;
  pumps: FuelSettingsPumpRow[];
  pumpsById: Record<string, FuelSettingsPumpRow>;
};

export type FuelTransaction = {
  personPin: string;
  vehicleId: string;
  dateDay: string;
  dateTime: string;
  transactionNumber: string;
  gallons: number;
  pricePerGallon: number;
  personShortname: string;
  vehicleShortname: string;
  pumpNumber: string;
  date: Date;
  sourceFile: string;
  rawLineNumber: number;
};

export type LoadedExportSummary = {
  fileName: string;
  csvFileCount: number;
  transactionCount: number;
  minDateText: string;
  maxDateText: string;
};

export type FuelReportEntry = {
  date: Date;
  personName: string;
  vehicleName: string;
  gallons: number;
};

export type FuelReportPumpSection = {
  pumpId: string;
  pumpName: string;
  entries: FuelReportEntry[];
  totalGallons: number;
};

export type FuelReportGroupSection = {
  groupId: string;
  groupName: string;
  print: boolean;
  pumpSections: FuelReportPumpSection[];
};

export type FuelReport = {
  reportMonth: number;
  reportYear: number;
  fileStem: string;
  start: Date;
  end: Date;
  startText: string;
  endText: string;
  fullSections: FuelReportGroupSection[];
  printSections: FuelReportGroupSection[];
};

export type UserFacingError = {
  kind: 'missing-person' | 'missing-vehicle' | 'missing-group' | 'missing-pump' | 'invalid-settings' | 'generic';
  title: string;
  message: string;
  details?: string;
};

export type FlashMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
};

export type DownloadSummary = {
  fileName: string;
  byteCount: number;
  createdAtText: string;
};

import { observable } from 'mobx';
import { getPreviousMonthYear } from '../lib/date';
import type {
  DownloadSummary,
  FlashMessage,
  FuelDriveExportFile,
  FuelSettings,
  FuelTransaction,
  LoadedExportSummary,
  UserFacingError,
} from '../lib/types';
import { EXPORTS_FOLDER_PATH, SETTINGS_FILE_PATH } from '../lib/settings';

const { month, year } = getPreviousMonthYear();

export type State = {
  settingsPath: string;
  driveExportsPath: string;
  isInitializing: boolean;
  initializationError: string;
  settings: FuelSettings | null;
  transactions: FuelTransaction[];
  exportSummary: LoadedExportSummary | null;
  availableDriveExports: FuelDriveExportFile[];
  selectedDriveExports: FuelDriveExportFile[];
  selectedDriveExportTarget: FuelDriveExportFile | null;
  driveExportsBusy: boolean;
  driveExportsListingError: string;
  driveExportsSelectionError: string;
  driveLoadBusy: boolean;
  reportMonth: number;
  reportYear: number;
  reportBusy: boolean;
  reportError: UserFacingError | null;
  flashMessage: FlashMessage | null;
  lastDownload: DownloadSummary | null;
};

export const state = observable<State>({
  settingsPath: SETTINGS_FILE_PATH,
  driveExportsPath: EXPORTS_FOLDER_PATH,
  isInitializing: true,
  initializationError: '',
  settings: null,
  transactions: [],
  exportSummary: null,
  availableDriveExports: [],
  selectedDriveExports: [],
  selectedDriveExportTarget: null,
  driveExportsBusy: false,
  driveExportsListingError: '',
  driveExportsSelectionError: '',
  driveLoadBusy: false,
  reportMonth: month,
  reportYear: year,
  reportBusy: false,
  reportError: null,
  flashMessage: null,
  lastDownload: null,
});

import { observable } from 'mobx';
import { getPreviousMonthYear } from '../lib/date';
import type {
  DownloadSummary,
  FlashMessage,
  FuelSettings,
  FuelTransaction,
  LoadedExportSummary,
  UserFacingError,
} from '../lib/types';
import { SETTINGS_FILE_PATH } from '../lib/settings';

const { month, year } = getPreviousMonthYear();

export type State = {
  settingsPath: string;
  isInitializing: boolean;
  initializationError: string;
  settings: FuelSettings | null;
  transactions: FuelTransaction[];
  exportSummary: LoadedExportSummary | null;
  reportMonth: number;
  reportYear: number;
  reportBusy: boolean;
  reportError: UserFacingError | null;
  flashMessage: FlashMessage | null;
  lastDownload: DownloadSummary | null;
};

export const state = observable<State>({
  settingsPath: SETTINGS_FILE_PATH,
  isInitializing: true,
  initializationError: '',
  settings: null,
  transactions: [],
  exportSummary: null,
  reportMonth: month,
  reportYear: year,
  reportBusy: false,
  reportError: null,
  flashMessage: null,
  lastDownload: null,
});

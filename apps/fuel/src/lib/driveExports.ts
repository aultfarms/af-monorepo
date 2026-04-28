import * as google from '@aultfarms/google';
import JSZip from 'jszip';
import { toFileStem } from './date';
import { EXPORTS_FOLDER_PATH } from './settings';
import type { FuelDriveExportFile } from './types';

const EXPORT_FILE_NAME_PATTERN = /^(\d{4})-(\d{2})\.csv$/i;
const DRIVE_FOLDER_ERROR_MESSAGE = `Could not open the Google Drive exports folder at ${EXPORTS_FOLDER_PATH}. Make sure the folder exists next to the settings spreadsheet.`;
const NO_EXPORTS_ERROR_MESSAGE = `No CSV exports matching YYYY-MM.csv were found in ${EXPORTS_FOLDER_PATH}.`;

function parseDriveExportFile(file: { id: string; name: string }) {
  const match = file.name.match(EXPORT_FILE_NAME_PATTERN);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    id: file.id,
    name: file.name,
    year,
    month,
    monthKey: `${match[1]}-${match[2]}`,
  } satisfies FuelDriveExportFile;
}

export function getDriveExportsFolderErrorMessage() {
  return DRIVE_FOLDER_ERROR_MESSAGE;
}

export function getNoDriveExportsErrorMessage() {
  return NO_EXPORTS_ERROR_MESSAGE;
}

export async function listFuelDriveExports() {
  let listing;
  try {
    listing = await google.drive.ls({ path: EXPORTS_FOLDER_PATH });
  } catch {
    throw new Error(DRIVE_FOLDER_ERROR_MESSAGE);
  }

  if (!listing) {
    throw new Error(DRIVE_FOLDER_ERROR_MESSAGE);
  }

  const files = listing.contents
    .filter(file => file.mimeType !== 'application/vnd.google-apps.folder')
    .map(parseDriveExportFile)
    .filter((file): file is FuelDriveExportFile => Boolean(file))
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey) || left.name.localeCompare(right.name));

  if (files.length < 1) {
    throw new Error(NO_EXPORTS_ERROR_MESSAGE);
  }

  return files;
}

export function getFuelDriveExportSelection(
  files: FuelDriveExportFile[],
  reportMonth: number,
  reportYear: number,
) {
  const requestedMonthKey = toFileStem(reportMonth, reportYear);
  if (files.length < 1) {
    return {
      requestedMonthKey,
      targetFile: null,
      selectedFiles: [],
      error: NO_EXPORTS_ERROR_MESSAGE,
    };
  }

  const targetIndex = files.findIndex(file => file.monthKey === requestedMonthKey);
  if (targetIndex < 0) {
    return {
      requestedMonthKey,
      targetFile: null,
      selectedFiles: [],
      error: `Could not find ${requestedMonthKey}.csv in ${EXPORTS_FOLDER_PATH}.`,
    };
  }

  const startIndex = Math.max(0, targetIndex - 2);
  const endIndex = Math.min(files.length, targetIndex + 3);

  return {
    requestedMonthKey,
    targetFile: files[targetIndex] || null,
    selectedFiles: files.slice(startIndex, endIndex),
    error: '',
  };
}

export async function buildFuelDriveExportsZipFile({
  files,
  requestedMonthKey,
}: {
  files: FuelDriveExportFile[];
  requestedMonthKey: string;
}) {
  const downloads = await Promise.all(
    files.map(async file => ({
      name: file.name,
      contents: await google.drive.getFileContents({ id: file.id }),
    })),
  );

  const zip = new JSZip();
  downloads.forEach(download => {
    zip.file(download.name, download.contents);
  });

  const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([zipBuffer], `fuel-exports-${requestedMonthKey}.zip`, {
    type: 'application/zip',
  });
}

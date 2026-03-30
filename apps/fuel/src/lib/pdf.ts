import JSZip from 'jszip';
import { formatGallons, formatRowDateTime } from './date';
import type { FuelReport, FuelReportGroupSection, FuelReportPumpSection } from './types';

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const LEFT_MARGIN = 72;
const RIGHT_MARGIN = PAGE_WIDTH - 72;
const TOP_Y = PAGE_HEIGHT - 72;
const BOTTOM_Y = 72;

function escapePdfText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function padText(value: string, width: number, alignment: 'left' | 'right' = 'left') {
  if (value.length > width) {
    if (width <= 3) {
      return value.slice(0, width);
    }
    return `${value.slice(0, width - 3)}...`;
  }

  if (alignment === 'right') {
    return value.padStart(width, ' ');
  }

  return value.padEnd(width, ' ');
}

class PdfPageBuilder {
  commands: string[] = [];

  addText(text: string, x: number, y: number, font: 'F1' | 'F2' | 'F3' | 'F4', size: number) {
    this.commands.push(
      'BT',
      `/${font} ${size} Tf`,
      `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
      `(${escapePdfText(text)}) Tj`,
      'ET',
    );
  }

  addLine(x1: number, y1: number, x2: number, y2: number) {
    this.commands.push(
      `${x1.toFixed(2)} ${y1.toFixed(2)} m`,
      `${x2.toFixed(2)} ${y2.toFixed(2)} l`,
      'S',
    );
  }

  toStream() {
    return this.commands.join('\n');
  }
}

function buildPdfBytes(streams: string[]) {
  const objects: string[] = [];
  const pushObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const pagesId = pushObject('');
  const fontRegularId = pushObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = pushObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const monoRegularId = pushObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const monoBoldId = pushObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
  const pageIds: number[] = [];

  streams.forEach(stream => {
    const contentId = pushObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = pushObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${monoRegularId} 0 R /F4 ${monoBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  });

  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;
  const catalogId = pushObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let documentText = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
  const offsets: number[] = [0];

  objects.forEach((content, index) => {
    offsets[index + 1] = documentText.length;
    documentText += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xrefStart = documentText.length;
  documentText += `xref\n0 ${objects.length + 1}\n`;
  documentText += '0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => {
    documentText += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  documentText += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  documentText += `startxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(documentText);
}

function renderEmptyPage(report: FuelReport) {
  const page = new PdfPageBuilder();
  page.addText(`${report.startText} - ${report.endText}`, LEFT_MARGIN, TOP_Y, 'F1', 11);
  page.addText('No transactions found', LEFT_MARGIN, TOP_Y - 28, 'F2', 18);
  page.addLine(LEFT_MARGIN, TOP_Y - 38, RIGHT_MARGIN, TOP_Y - 38);
  page.addText('There were no fuel transactions in the selected reporting window.', LEFT_MARGIN, TOP_Y - 72, 'F1', 12);
  return [page.toStream()];
}

function tableHeaderLine() {
  return `${padText('Date/Time', 24)}  ${padText('Person', 20)}  ${padText('Vehicle', 36)}  ${padText('Gallons', 10, 'right')}`;
}

function entryLine(entry: FuelReportPumpSection['entries'][number]) {
  return `${padText(formatRowDateTime(entry.date), 24)}  ${padText(entry.personName, 20)}  ${padText(entry.vehicleName, 36)}  ${padText(formatGallons(entry.gallons), 10, 'right')}`;
}

function totalLine(pumpSection: FuelReportPumpSection) {
  return `${padText('', 24)}  ${padText('', 20)}  ${padText(`TOTAL ${pumpSection.pumpName}:`, 36)}  ${padText(formatGallons(pumpSection.totalGallons), 10, 'right')}`;
}

function renderSectionPages(report: FuelReport, section: FuelReportGroupSection) {
  const pages: PdfPageBuilder[] = [];
  let currentPage: PdfPageBuilder | null = null;
  let cursorY = TOP_Y - 60;

  const startPage = (continued: boolean, pumpSection?: FuelReportPumpSection) => {
    currentPage = new PdfPageBuilder();
    pages.push(currentPage);
    currentPage.addText(`${report.startText} - ${report.endText}`, LEFT_MARGIN, TOP_Y, 'F1', 11);
    currentPage.addText(
      continued ? `${section.groupName} (continued)` : section.groupName,
      LEFT_MARGIN,
      TOP_Y - 28,
      'F2',
      18,
    );
    currentPage.addLine(LEFT_MARGIN, TOP_Y - 40, RIGHT_MARGIN, TOP_Y - 40);
    cursorY = TOP_Y - 64;

    if (pumpSection) {
      currentPage.addText(pumpSection.pumpName, LEFT_MARGIN, cursorY, 'F2', 12);
      cursorY -= 16;
      currentPage.addText(tableHeaderLine(), LEFT_MARGIN, cursorY, 'F4', 9);
      currentPage.addLine(LEFT_MARGIN, cursorY - 4, RIGHT_MARGIN, cursorY - 4);
      cursorY -= 18;
    }
  };

  startPage(false);

  section.pumpSections.forEach(pumpSection => {
    if (!currentPage) {
      startPage(false);
    }

    if (cursorY < BOTTOM_Y + 60) {
      startPage(true, pumpSection);
    } else {
      currentPage!.addText(pumpSection.pumpName, LEFT_MARGIN, cursorY, 'F2', 12);
      cursorY -= 16;
      currentPage!.addText(tableHeaderLine(), LEFT_MARGIN, cursorY, 'F4', 9);
      currentPage!.addLine(LEFT_MARGIN, cursorY - 4, RIGHT_MARGIN, cursorY - 4);
      cursorY -= 18;
    }

    pumpSection.entries.forEach(entry => {
      if (cursorY < BOTTOM_Y + 28) {
        startPage(true, pumpSection);
      }

      currentPage!.addText(entryLine(entry), LEFT_MARGIN, cursorY, 'F3', 9);
      cursorY -= 12;
    });

    if (cursorY < BOTTOM_Y + 28) {
      startPage(true, pumpSection);
    }

    currentPage!.addText(totalLine(pumpSection), LEFT_MARGIN, cursorY, 'F4', 9);
    cursorY -= 18;
  });

  return pages.map(page => page.toStream());
}

function renderReportPages(report: FuelReport, printVersion: boolean) {
  const sections = printVersion ? report.printSections : report.fullSections;
  if (sections.length < 1) {
    return renderEmptyPage(report);
  }

  return sections.flatMap(section => renderSectionPages(report, section));
}

export function buildReportPdfBytes(report: FuelReport, printVersion: boolean) {
  return buildPdfBytes(renderReportPages(report, printVersion));
}

export async function buildReportZipBlob(report: FuelReport) {
  const fullPdf = buildReportPdfBytes(report, false);
  const printPdf = buildReportPdfBytes(report, true);
  const fullName = `${report.fileStem}.pdf`;
  const printName = `${report.fileStem}_print.pdf`;
  const zipName = `fuel-report-${report.fileStem}.zip`;
  const zip = new JSZip();

  zip.file(fullName, fullPdf);
  zip.file(printName, printPdf);

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const blob = new Blob([zipBytes], { type: 'application/zip' });
  return {
    blob,
    fileName: zipName,
    byteCount: blob.size,
  };
}

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { parseFuelExportsZipFile } from '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/src/lib/csv.ts'
import { buildReportZipBlob } from '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/src/lib/pdf.ts'
import { defaultGroups, defaultPeople, defaultPumps, defaultVehicles } from '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/src/lib/defaultSettings.ts'
import { buildFuelReport } from '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/src/lib/reporting.ts'
import type { FuelSettings } from '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/src/lib/types.ts'

const fixturePath = '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/fixtures/fuel-exports-2026-02.zip'
const outDir = '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/tmp'

function mapRowsById<T extends { id: string }>(rows: T[]) {
  return rows.reduce<Record<string, T>>((result, row) => {
    result[row.id] = row
    return result
  }, {})
}

const settings: FuelSettings = {
  spreadsheetId: 'local-smoke-test',
  spreadsheetPath: fixturePath,
  spreadsheetUrl: 'https://example.invalid/fuel-smoke-test',
  groups: defaultGroups,
  groupsById: mapRowsById(defaultGroups),
  people: defaultPeople,
  peopleById: mapRowsById(defaultPeople),
  vehicles: defaultVehicles,
  vehiclesById: mapRowsById(defaultVehicles),
  pumps: defaultPumps,
  pumpsById: mapRowsById(defaultPumps),
}

const fixtureBytes = await readFile(fixturePath)
const file = new File([fixtureBytes], 'fuel-exports-2026-02.zip', { type: 'application/zip' })
const { transactions, summary } = await parseFuelExportsZipFile(file)

const report = buildFuelReport({
  transactions,
  settings,
  reportMonth: 2,
  reportYear: 2026,
})

const { blob, byteCount, fileName } = await buildReportZipBlob(report)
await mkdir(outDir, { recursive: true })

const outPath = `${outDir}/${fileName}`
await writeFile(outPath, Buffer.from(await blob.arrayBuffer()))

const builtZip = await JSZip.loadAsync(await readFile(outPath))
const zipEntries = Object.values(builtZip.files)
  .filter(entry => !entry.dir)
  .map(entry => entry.name)
  .sort()

const entrySizes = await Promise.all(
  zipEntries.map(async name => {
    const entry = builtZip.file(name)
    const bytes = entry ? await entry.async('uint8array') : new Uint8Array()
    return { name, bytes: bytes.byteLength }
  }),
)

console.log(
  JSON.stringify(
    {
      summary,
      filteredTransactionCount: report.fullSections
        .flatMap(section => section.pumpSections)
        .flatMap(section => section.entries).length,
      fullSectionCount: report.fullSections.length,
      printSectionCount: report.printSections.length,
      zipFileName: fileName,
      zipByteCount: byteCount,
      zipEntries,
      entrySizes,
      outputPath: outPath,
    },
    null,
    2,
  ),
)

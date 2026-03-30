const fs = require('fs');
const vm = require('vm');

const sourcePath = '/Users/aultac/Mega-AultFarms/Fuel_System/run_report/report.js';
const outPath = '/Users/aultac/repos/aultfarms/af-monorepo/apps/fuel/src/lib/defaultSettings.ts';

const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('let order=0;');
const end = source.indexOf("debug('Loading records from exports...')");

if (start < 0 || end < 0 || end <= start) {
  throw new Error('Could not locate settings block in legacy report.js');
}

const snippet = `${source.slice(start, end)}
module.exports = { groups, people, vehicles, pumps };
`;

const context = {
  module: { exports: {} },
  exports: {},
};

vm.runInNewContext(snippet, context, { filename: sourcePath });

const { groups, people, vehicles, pumps } = context.module.exports;

const toBool = (value) => Boolean(value);
const toString = (value) => (typeof value === 'string' ? value : '');

const groupRows = Object.entries(groups)
  .map(([id, value]) => ({
    id,
    name: toString(value.name),
    print: toBool(value.print),
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const personRows = Object.entries(people)
  .map(([id, value]) => ({
    id,
    name: toString(value.name),
    group: toString(value.group),
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const vehicleRows = Object.entries(vehicles)
  .map(([id, value]) => ({
    id,
    name: toString(value.name),
    group: toString(value.group),
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const pumpRows = Object.entries(pumps)
  .map(([id, name]) => ({
    id,
    name: toString(name),
  }))
  .sort((a, b) => Number(a.id) - Number(b.id));

let content = '';
content += `export const defaultGroups = ${JSON.stringify(groupRows, null, 2)} as const;\n\n`;
content += `export const defaultPeople = ${JSON.stringify(personRows, null, 2)} as const;\n\n`;
content += `export const defaultVehicles = ${JSON.stringify(vehicleRows, null, 2)} as const;\n\n`;
content += `export const defaultPumps = ${JSON.stringify(pumpRows, null, 2)} as const;\n`;

fs.writeFileSync(outPath, content);
console.log(`Wrote ${outPath}`);

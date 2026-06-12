import {
  createLoadGroupKey,
  type LoadsRecord,
  type SpreadRegion,
} from '@aultfarms/manure';
export type LoadRowSummary = {
  id: string;
  record: LoadsRecord;
  regionIds: string[];
};

export type LoadGroupSummary = {
  loadGroupKey: string;
  date: string;
  field: string;
  source: string;
  totalLoads: number;
  assignedLoads: number;
  unassignedLoads: number;
  loadIds: string[];
  assignedLoadIds: string[];
  unassignedLoadIds: string[];
  regionIds: string[];
  drivers: string[];
  loadRows: LoadRowSummary[];
};

function uniqueStrings(values: string[]): string[] {
  return [ ...new Set(values.filter(Boolean)) ];
}
function recordSortKey(record: LoadsRecord): string {
  return record.timestamp || record.createdAt || record.updatedAt || '';
}

function loadRowId(record: LoadsRecord): string {
  return record.id || [
    createLoadGroupKey(record),
    record.driver,
    record.timestamp || record.createdAt || record.updatedAt || '',
  ].join('__');
}

function buildRegionIdsByLoadId(regions: SpreadRegion[]): Map<string, string[]> {
  const byLoadId = new Map<string, string[]>();
  for (const region of regions) {
    if (!region.id) {
      continue;
    }

    for (const loadId of uniqueStrings(region.loadIds || [])) {
      const existing = byLoadId.get(loadId) || [];
      if (!existing.includes(region.id)) {
        existing.push(region.id);
      }
      byLoadId.set(loadId, existing);
    }
  }

  return byLoadId;
}

export function summarizeLoadGroups(
  loads: LoadsRecord[],
  regions: SpreadRegion[],
  year?: number,
): LoadGroupSummary[] {
  const regionIdsByLoadId = buildRegionIdsByLoadId(regions);
  const byKey = new Map<string, LoadGroupSummary>();

  for (const load of loads) {
    if (year && !load.date.startsWith(`${year}-`)) {
      continue;
    }

    const loadGroupKey = createLoadGroupKey(load);
    const id = loadRowId(load);
    const regionIds = uniqueStrings(regionIdsByLoadId.get(id) || []);
    const existing: LoadGroupSummary = byKey.get(loadGroupKey) || {
      loadGroupKey,
      date: load.date,
      field: load.field,
      source: load.source,
      totalLoads: 0,
      assignedLoads: 0,
      unassignedLoads: 0,
      loadIds: [],
      assignedLoadIds: [],
      unassignedLoadIds: [],
      regionIds: [],
      drivers: [],
      loadRows: [],
    };

    existing.totalLoads += load.loads;
    existing.loadIds.push(id);
    existing.regionIds.push(...regionIds);
    existing.drivers.push(load.driver);
    if (regionIds.length > 0) {
      existing.assignedLoads += load.loads;
      existing.assignedLoadIds.push(id);
    } else {
      existing.unassignedLoads += load.loads;
      existing.unassignedLoadIds.push(id);
    }
    existing.loadRows.push({
      id,
      record: load,
      regionIds,
    });
    byKey.set(loadGroupKey, existing);
  }

  return [ ...byKey.values() ]
    .map(group => ({
      ...group,
      assignedLoads: Math.min(group.assignedLoads, group.totalLoads),
      unassignedLoads: Math.max(group.unassignedLoads, 0),
      loadIds: uniqueStrings(group.loadIds),
      assignedLoadIds: uniqueStrings(group.assignedLoadIds),
      unassignedLoadIds: uniqueStrings(group.unassignedLoadIds),
      regionIds: uniqueStrings(group.regionIds),
      drivers: uniqueStrings(group.drivers).sort((left, right) => left.localeCompare(right)),
      loadRows: [ ...group.loadRows ].sort((left, right) => {
        const byTimestamp = recordSortKey(left.record).localeCompare(recordSortKey(right.record));
        if (byTimestamp !== 0) return byTimestamp;
        const byDriver = left.record.driver.localeCompare(right.record.driver);
        if (byDriver !== 0) return byDriver;
        return left.id.localeCompare(right.id);
      }),
    }))
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      if (byDate !== 0) return byDate;
      const byField = left.field.localeCompare(right.field);
      if (byField !== 0) return byField;
      return left.source.localeCompare(right.source);
    });
}

export function summarizeLoadGroupsByKey(
  loads: LoadsRecord[],
  regions: SpreadRegion[],
  year?: number,
): Map<string, LoadGroupSummary> {
  return new Map(
    summarizeLoadGroups(loads, regions, year).map(group => [ group.loadGroupKey, group ]),
  );
}

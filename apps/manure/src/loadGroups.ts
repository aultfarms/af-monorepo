import {
  createLoadGroupKey,
  type LoadsRecord,
  type SpreadRegionAssignment,
} from '@aultfarms/manure';

export type LoadGroupSummary = {
  loadGroupKey: string;
  date: string;
  field: string;
  source: string;
  totalLoads: number;
  assignedLoads: number;
  unassignedLoads: number;
  regionIds: string[];
  records: LoadsRecord[];
};

function uniqueStrings(values: string[]): string[] {
  return [ ...new Set(values.filter(Boolean)) ];
}

export function summarizeLoadGroups(
  loads: LoadsRecord[],
  assignments: SpreadRegionAssignment[],
  year?: number,
): LoadGroupSummary[] {
  const byKey = new Map<string, LoadGroupSummary>();

  for (const load of loads) {
    if (year && !load.date.startsWith(`${year}-`)) {
      continue;
    }

    const loadGroupKey = createLoadGroupKey(load);
    const existing = byKey.get(loadGroupKey) || {
      loadGroupKey,
      date: load.date,
      field: load.field,
      source: load.source,
      totalLoads: 0,
      assignedLoads: 0,
      unassignedLoads: 0,
      regionIds: [],
      records: [],
    };

    existing.totalLoads += load.loads;
    existing.records.push(load);
    byKey.set(loadGroupKey, existing);
  }

  for (const assignment of assignments) {
    const existing = byKey.get(assignment.loadGroupKey);
    if (!existing) {
      continue;
    }

    existing.assignedLoads += assignment.loadCount;
    existing.regionIds.push(assignment.regionId);
  }

  return [ ...byKey.values() ]
    .map(group => ({
      ...group,
      assignedLoads: Math.min(group.assignedLoads, group.totalLoads),
      unassignedLoads: Math.max(group.totalLoads - group.assignedLoads, 0),
      regionIds: uniqueStrings(group.regionIds),
      records: [ ...group.records ].sort((left, right) => left.driver.localeCompare(right.driver)),
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
  assignments: SpreadRegionAssignment[],
  year?: number,
): Map<string, LoadGroupSummary> {
  return new Map(
    summarizeLoadGroups(loads, assignments, year).map(group => [ group.loadGroupKey, group ]),
  );
}

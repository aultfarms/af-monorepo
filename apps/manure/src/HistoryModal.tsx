import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  Modal,
  OutlinedInput,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { summarizeLoadGroups, summarizeLoadGroupsByKey, type LoadGroupSummary } from './loadGroups';
import { context } from './state';
import type { HistoryDatePreset } from './state/state';

const DEFAULT_ROWS_PER_PAGE = 30;
const ROWS_PER_PAGE_OPTIONS = [ 30, 50, 100 ];

type HistoryRow = LoadGroupSummary & {
  partialMatch: boolean;
};
type DateRange = {
  dateStart: string;
  dateEnd: string;
};
type TallyItem = {
  label: string;
  value: number;
};
type SummaryRow = {
  type: 'Driver' | 'Field' | 'Source';
  name: string;
  loads: number;
};

const DATE_PRESETS: Array<{ key: HistoryDatePreset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'last7Days', label: 'Last 7 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'thisYear', label: 'This year' },
  { key: 'custom', label: 'Custom' },
];

function uniqueSorted(values: string[]): string[] {
  return [ ...new Set(values.filter(Boolean)) ].sort((left, right) => left.localeCompare(right));
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function presetDateRange(datePreset: Exclude<HistoryDatePreset, 'custom'>, year: number): DateRange {
  const today = new Date();

  if (datePreset === 'today') {
    const todayValue = toDateInputValue(today);
    return {
      dateStart: todayValue,
      dateEnd: todayValue,
    };
  }

  if (datePreset === 'thisWeek') {
    const dateStart = addDays(today, -today.getDay());
    return {
      dateStart: toDateInputValue(dateStart),
      dateEnd: toDateInputValue(addDays(dateStart, 6)),
    };
  }

  if (datePreset === 'last7Days') {
    return {
      dateStart: toDateInputValue(addDays(today, -6)),
      dateEnd: toDateInputValue(today),
    };
  }

  if (datePreset === 'thisMonth') {
    const dateStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const dateEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
      dateStart: toDateInputValue(dateStart),
      dateEnd: toDateInputValue(dateEnd),
    };
  }

  return {
    dateStart: `${year}-01-01`,
    dateEnd: `${year}-12-31`,
  };
}

function normalizeDateInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function loadDateInRange(loadDate: string, dateStart: string, dateEnd: string): boolean {
  const normalizedLoadDate = normalizeDateInput(loadDate);
  if (!normalizedLoadDate) {
    return false;
  }

  let normalizedDateStart = normalizeDateInput(dateStart);
  let normalizedDateEnd = normalizeDateInput(dateEnd);
  if (normalizedDateStart && normalizedDateEnd && normalizedDateStart > normalizedDateEnd) {
    [ normalizedDateStart, normalizedDateEnd ] = [ normalizedDateEnd, normalizedDateStart ];
  }

  return (
    (!normalizedDateStart || normalizedLoadDate >= normalizedDateStart)
    && (!normalizedDateEnd || normalizedLoadDate <= normalizedDateEnd)
  );
}

function buildSummaryRows(
  type: SummaryRow['type'],
  values: Array<{ name: string; loads: number }>,
): SummaryRow[] {
  const loadsByName = new Map<string, number>();
  for (const value of values) {
    const name = value.name || '—';
    loadsByName.set(name, (loadsByName.get(name) || 0) + value.loads);
  }

  return [ ...loadsByName.entries() ]
    .map(([ name, loads ]) => ({ type, name, loads }))
    .sort((left, right) => {
      const byLoads = right.loads - left.loads;
      if (byLoads !== 0) return byLoads;
      return left.name.localeCompare(right.name);
    });
}

function normalizeMultiSelectValue(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every(value => rightSet.has(value));
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return '—';
  }
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }
  return parsedDate.toLocaleString();
}

function renderMultiValueLabel(values: string[]): string {
  return values.length < 1 ? 'All' : values.join(', ');
}

export const HistoryModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const { modalOpen, deleting, filters, expandedLoadGroupKeys } = state.historyManagement;
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(DEFAULT_ROWS_PER_PAGE);
  const [correctionOpen, setCorrectionOpen] = React.useState(false);
  const [correctionPercent, setCorrectionPercent] = React.useState('');

  React.useEffect(() => {
    if (modalOpen) {
      setPage(0);
    } else {
      setCorrectionOpen(false);
      setCorrectionPercent('');
    }
  }, [modalOpen]);

  const availableDrivers = React.useMemo(
    () => uniqueSorted(state.loads.map(load => load.driver)),
    [state.loads],
  );
  const availableFields = React.useMemo(
    () => uniqueSorted(state.loads.map(load => load.field)),
    [state.loads],
  );
  const availableSources = React.useMemo(
    () => uniqueSorted(state.loads.map(load => load.source)),
    [state.loads],
  );
  const fullRowsByKey = React.useMemo(
    () => summarizeLoadGroupsByKey(state.loads, state.regions, state.thisYear),
    [state.loads, state.regions, state.thisYear],
  );
  const defaultDateRange = React.useMemo(
    () => presetDateRange('thisYear', state.thisYear),
    [state.thisYear],
  );
  const filteredLoads = React.useMemo(
    () => state.loads.filter(load => (
      loadDateInRange(load.date, filters.dateStart, filters.dateEnd)
      && (filters.drivers.length < 1 || filters.drivers.includes(load.driver))
      && (filters.fields.length < 1 || filters.fields.includes(load.field))
      && (filters.sources.length < 1 || filters.sources.includes(load.source))
    )),
    [filters.dateEnd, filters.dateStart, filters.drivers, filters.fields, filters.sources, state.loads],
  );
  const rows = React.useMemo<HistoryRow[]>(
    () => summarizeLoadGroups(filteredLoads, state.regions, state.thisYear).map(row => {
      const fullRow = fullRowsByKey.get(row.loadGroupKey);
      return {
        ...row,
        partialMatch: !!fullRow && !sameStringSet(row.loadIds, fullRow.loadIds),
      };
    }),
    [filteredLoads, fullRowsByKey, state.regions, state.thisYear],
  );
  const rowsByKey = React.useMemo(
    () => new Map(rows.map(row => [ row.loadGroupKey, row ])),
    [rows],
  );
  const selectedKeys = state.historyManagement.selectedLoadGroupKeys;
  const selectedRows = React.useMemo(
    () => selectedKeys
      .map(loadGroupKey => rowsByKey.get(loadGroupKey))
      .filter((row): row is HistoryRow => !!row),
    [rowsByKey, selectedKeys],
  );
  const hasPartialSelection = selectedRows.some(row => row.partialMatch);
  const partialRowCount = React.useMemo(
    () => rows.filter(row => row.partialMatch).length,
    [rows],
  );
  const summaryRows = React.useMemo<SummaryRow[]>(
    () => [
      ...buildSummaryRows('Driver', filteredLoads.map(load => ({ name: load.driver, loads: load.loads }))),
      ...buildSummaryRows('Field', filteredLoads.map(load => ({ name: load.field, loads: load.loads }))),
      ...buildSummaryRows('Source', filteredLoads.map(load => ({ name: load.source, loads: load.loads }))),
    ],
    [filteredLoads],
  );
  const tallyItems = React.useMemo<TallyItem[]>(() => {
    const uniqueRegionIds = new Set(rows.flatMap(row => row.regionIds));
    return [
      { label: 'Days', value: new Set(filteredLoads.map(load => load.date).filter(Boolean)).size },
      { label: 'Fields', value: new Set(filteredLoads.map(load => load.field).filter(Boolean)).size },
      { label: 'Sources', value: new Set(filteredLoads.map(load => load.source).filter(Boolean)).size },
      { label: 'Drivers', value: new Set(filteredLoads.map(load => load.driver).filter(Boolean)).size },
      { label: 'Loads', value: filteredLoads.reduce((sum, load) => sum + load.loads, 0) },
      { label: 'Rows', value: rows.length },
      { label: 'Assigned', value: rows.reduce((sum, row) => sum + row.assignedLoads, 0) },
      { label: 'Unassigned', value: rows.reduce((sum, row) => sum + row.unassignedLoads, 0) },
      { label: 'Regions', value: uniqueRegionIds.size },
    ];
  }, [filteredLoads, rows]);
  const hasActiveDateFilter = (
    filters.datePreset !== 'thisYear'
    || filters.dateStart !== defaultDateRange.dateStart
    || filters.dateEnd !== defaultDateRange.dateEnd
  );
  const hasActiveFilters = (
    hasActiveDateFilter
    || filters.drivers.length > 0
    || filters.fields.length > 0
    || filters.sources.length > 0
  );

  React.useEffect(() => {
    const maxPage = Math.max(Math.ceil(rows.length / rowsPerPage) - 1, 0);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [page, rows.length, rowsPerPage]);

  const pagedRows = React.useMemo(
    () => rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage),
    [page, rows, rowsPerPage],
  );

  const setMultiFilter = React.useCallback((
    key: 'drivers' | 'fields' | 'sources',
    event: SelectChangeEvent<string[]>,
  ) => {
    actions.setHistoryFilters({
      [key]: normalizeMultiSelectValue(event.target.value),
    } as Pick<typeof filters, typeof key>);
  }, [actions]);

  const setDatePreset = React.useCallback((datePreset: HistoryDatePreset) => {
    if (datePreset === 'custom') {
      actions.setHistoryFilters({ datePreset });
      return;
    }

    actions.setHistoryFilters({
      datePreset,
      ...presetDateRange(datePreset, state.thisYear),
    });
  }, [actions, state.thisYear]);

  const setCustomDateBoundary = React.useCallback((key: 'dateStart' | 'dateEnd', value: string) => {
    const nextFilters: Partial<typeof filters> = {
      datePreset: 'custom',
    };
    nextFilters[key] = value;
    actions.setHistoryFilters(nextFilters);
  }, [actions]);

  const applyCorrection = React.useCallback(async () => {
    const percent = Number.parseFloat(correctionPercent);
    const applied = await actions.applyHistoryCorrection(filteredLoads, percent);
    if (applied) {
      setCorrectionOpen(false);
      setCorrectionPercent('');
    }
  }, [actions, correctionPercent, filteredLoads]);

  return (
    <Modal open={modalOpen} onClose={() => !deleting && actions.closeHistoryModal()}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(1400px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        bgcolor: 'white',
        p: 3,
        boxSizing: 'border-box',
      }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h6">History</Typography>
            <Typography variant="body2" color="text.secondary">
              Grouped by day, field, and source with expandable load-level detail.
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              disabled={selectedKeys.length < 1 || deleting || hasPartialSelection}
              onClick={() => actions.openDrawModalForLoadGroups(selectedKeys, 'polygon')}
            >
              Draw Selected
            </Button>
            {state.auth.admin && (
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                disabled={selectedKeys.length < 1 || deleting || hasPartialSelection}
                onClick={() => void actions.deleteHistoryLoadGroups(selectedKeys)}
              >
                Delete Selected
              </Button>
            )}
            <Button
              variant="outlined"
              disabled={(selectedKeys.length < 1 && !hasActiveFilters) || deleting}
              onClick={() => {
                actions.clearHistoryLoadGroupSelection();
                actions.clearHistoryFilters();
              }}
            >
              Clear
            </Button>
            <Button variant="outlined" onClick={actions.closeHistoryModal} disabled={deleting}>
              Close
            </Button>
          </Box>
        </Box>

        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', lg: 'center' }}
          sx={{ mb: 2 }}
        >
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {DATE_PRESETS.map(datePreset => (
              <Button
                key={datePreset.key}
                size="small"
                variant={filters.datePreset === datePreset.key ? 'contained' : 'outlined'}
                onClick={() => setDatePreset(datePreset.key)}
              >
                {datePreset.label}
              </Button>
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Start"
              type="date"
              size="small"
              value={filters.dateStart}
              onChange={event => setCustomDateBoundary('dateStart', event.target.value)}
              sx={{ minWidth: 160 }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End"
              type="date"
              size="small"
              value={filters.dateEnd}
              onChange={event => setCustomDateBoundary('dateEnd', event.target.value)}
              sx={{ minWidth: 160 }}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
            <InputLabel id="history-driver-filter-label">Drivers</InputLabel>
            <Select
              labelId="history-driver-filter-label"
              multiple
              value={filters.drivers}
              onChange={event => setMultiFilter('drivers', event)}
              input={<OutlinedInput label="Drivers" />}
              renderValue={selected => renderMultiValueLabel(selected)}
            >
              {availableDrivers.map(driver => (
                <MenuItem key={driver} value={driver}>
                  <Checkbox size="small" checked={filters.drivers.includes(driver)} />
                  <ListItemText primary={driver} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
            <InputLabel id="history-field-filter-label">Fields</InputLabel>
            <Select
              labelId="history-field-filter-label"
              multiple
              value={filters.fields}
              onChange={event => setMultiFilter('fields', event)}
              input={<OutlinedInput label="Fields" />}
              renderValue={selected => renderMultiValueLabel(selected)}
            >
              {availableFields.map(field => (
                <MenuItem key={field} value={field}>
                  <Checkbox size="small" checked={filters.fields.includes(field)} />
                  <ListItemText primary={field} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
            <InputLabel id="history-source-filter-label">Sources</InputLabel>
            <Select
              labelId="history-source-filter-label"
              multiple
              value={filters.sources}
              onChange={event => setMultiFilter('sources', event)}
              input={<OutlinedInput label="Sources" />}
              renderValue={selected => renderMultiValueLabel(selected)}
            >
              {availableSources.map(source => (
                <MenuItem key={source} value={source}>
                  <Checkbox size="small" checked={filters.sources.includes(source)} />
                  <ListItemText primary={source} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Selected rows: {selectedKeys.length}
          {deleting ? ' • Deleting…' : ''}
          {partialRowCount > 0 ? ` • ${partialRowCount} filtered subset row${partialRowCount === 1 ? ' is' : 's are'} view-only until filters include the full grouped row.` : ''}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 1, mb: 2 }}>
          {tallyItems.map(item => (
            <Box
              key={item.label}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'grey.50',
                px: 1.5,
                py: 1,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {item.label}
              </Typography>
              <Typography variant="subtitle1" sx={{ lineHeight: 1.2 }}>
                {item.value}
              </Typography>
            </Box>
          ))}
        </Box>

        {summaryRows.length > 0 && (
          <Box sx={{ overflowX: 'auto', mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Summary
            </Typography>
            <Table size="small" sx={{ maxWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Loads</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summaryRows.map(row => (
                  <TableRow key={`${row.type}-${row.name}`}>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell align="right">{row.loads}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {rows.length === 0 ? (
          <Typography color="text.secondary">
            {hasActiveFilters ? 'No load history matches the current filters.' : 'No load history found yet.'}
          </Typography>
        ) : (
          <React.Fragment>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell padding="checkbox" />
                    <TableCell>Date</TableCell>
                    <TableCell>Field</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Drivers</TableCell>
                    <TableCell align="right">Loads</TableCell>
                    <TableCell align="right">Assigned</TableCell>
                    <TableCell align="right">Unassigned</TableCell>
                    <TableCell align="right">Regions</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pagedRows.map(row => {
                    const expanded = expandedLoadGroupKeys.includes(row.loadGroupKey);
                    const rowSelected = selectedKeys.includes(row.loadGroupKey);
                    return (
                      <React.Fragment key={row.loadGroupKey}>
                        <TableRow hover selected={rowSelected}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={rowSelected}
                              disabled={deleting || row.partialMatch}
                              onChange={() => actions.toggleHistoryLoadGroupSelection(row.loadGroupKey)}
                            />
                          </TableCell>
                          <TableCell padding="checkbox">
                            <IconButton
                              size="small"
                              onClick={() => actions.toggleHistoryLoadGroupExpansion(row.loadGroupKey)}
                            >
                              {expanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell>{row.date}</TableCell>
                          <TableCell>{row.field}</TableCell>
                          <TableCell>{row.source}</TableCell>
                          <TableCell>{row.drivers.join(', ') || '—'}</TableCell>
                          <TableCell align="right">{row.totalLoads}</TableCell>
                          <TableCell align="right">{row.assignedLoads}</TableCell>
                          <TableCell align="right">{row.unassignedLoads}</TableCell>
                          <TableCell align="right">{row.regionIds.length}</TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={1} justifyContent="flex-end" useFlexGap flexWrap="wrap">
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={deleting || row.partialMatch}
                                onClick={() => actions.openDrawModalForLoadGroups([ row.loadGroupKey ], 'load')}
                              >
                                Draw
                              </Button>
                              {state.auth.admin && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  disabled={deleting || row.partialMatch}
                                  onClick={() => void actions.deleteHistoryLoadGroups([ row.loadGroupKey ])}
                                >
                                  Delete
                                </Button>
                              )}
                              {row.partialMatch && (
                                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                  Filtered subset
                                </Typography>
                              )}
                            </Stack>
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow>
                            <TableCell colSpan={11} sx={{ py: 0, bgcolor: 'rgba(0, 0, 0, 0.02)' }}>
                              <Box sx={{ px: 2, py: 1.5 }}>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                  Individual loads
                                </Typography>
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>Recorded</TableCell>
                                      <TableCell>Driver</TableCell>
                                      <TableCell>Logged by</TableCell>
                                      <TableCell>Regions</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {row.loadRows.map(loadRow => (
                                      <TableRow key={loadRow.id}>
                                        <TableCell>
                                          {formatTimestamp(
                                            loadRow.record.timestamp
                                            || loadRow.record.createdAt
                                            || loadRow.record.updatedAt,
                                          )}
                                        </TableCell>
                                        <TableCell>{loadRow.record.driver || '—'}</TableCell>
                                        <TableCell>{loadRow.record.loggedBy || '—'}</TableCell>
                                        <TableCell>{loadRow.regionIds.length > 0 ? loadRow.regionIds.join(', ') : 'Unassigned'}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </Box>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
            <TablePagination
              component="div"
              count={rows.length}
              page={page}
              rowsPerPage={rowsPerPage}
              onPageChange={(_event, nextPage) => setPage(nextPage)}
              onRowsPerPageChange={event => {
                setRowsPerPage(Number.parseInt(event.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            />
          </React.Fragment>
        )}
        {state.auth.admin && (
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-start' }}>
            <IconButton
              size="small"
              disabled={deleting || filteredLoads.length < 1}
              onClick={() => setCorrectionOpen(true)}
              aria-label="Edit"
              sx={{ color: 'text.secondary' }}
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
        <Modal open={correctionOpen} onClose={() => !deleting && setCorrectionOpen(false)}>
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              void applyCorrection();
            }}
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(280px, calc(100vw - 32px))',
              bgcolor: 'white',
              p: 2,
              boxSizing: 'border-box',
            }}
          >
            <Stack spacing={2}>
              <TextField
                label="%"
                type="number"
                size="small"
                value={correctionPercent}
                onChange={event => setCorrectionPercent(event.target.value)}
                inputProps={{ min: 0, step: 1 }}
                autoFocus
              />
              <Button type="submit" variant="contained" disabled={deleting}>
                Apply
              </Button>
            </Stack>
          </Box>
        </Modal>
      </Box>
    </Modal>
  );
});

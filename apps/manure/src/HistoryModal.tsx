import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Box,
  Button,
  Checkbox,
  Modal,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { summarizeLoadGroups } from './loadGroups';
import { context } from './state';
const DEFAULT_ROWS_PER_PAGE = 30;
const ROWS_PER_PAGE_OPTIONS = [ 30, 50, 100 ];

export const HistoryModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const { modalOpen, deleting } = state.historyManagement;
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(DEFAULT_ROWS_PER_PAGE);

  React.useEffect(() => {
    if (modalOpen) {
      setPage(0);
    }
  }, [modalOpen]);
  const selectedKeys = state.historyManagement.selectedLoadGroupKeys;
  const rows = React.useMemo(
    () => summarizeLoadGroups(state.loads, state.regionAssignments, state.thisYear),
    [state.loads, state.regionAssignments, state.thisYear],
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

  return (
    <Modal open={modalOpen} onClose={() => !deleting && actions.closeHistoryModal()}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(1200px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        bgcolor: 'white',
        p: 3,
        boxSizing: 'border-box',
      }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box>
            <Typography variant="h6">History</Typography>
            <Typography variant="body2" color="text.secondary">
              Grouped by day, field, and source so you can review coverage and draw missing regions.
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              disabled={selectedKeys.length < 1 || deleting}
              onClick={() => actions.openDrawModalForLoadGroups(selectedKeys, 'polygon')}
            >
              Draw Selected
            </Button>
            {state.auth.admin && (
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                disabled={selectedKeys.length < 1 || deleting}
                onClick={() => void actions.deleteHistoryLoadGroups(selectedKeys)}
              >
                Delete Selected
              </Button>
            )}
            <Button
              variant="outlined"
              disabled={selectedKeys.length < 1 || deleting}
              onClick={actions.clearHistoryLoadGroupSelection}
            >
              Clear
            </Button>
            <Button variant="outlined" onClick={actions.closeHistoryModal} disabled={deleting}>
              Close
            </Button>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Selected rows: {selectedKeys.length}{deleting ? ' • Deleting…' : ''}
        </Typography>

        {rows.length === 0 ? (
          <Typography color="text.secondary">No load history found yet.</Typography>
        ) : (
          <React.Fragment>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Date</TableCell>
                    <TableCell>Field</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell align="right">Loads</TableCell>
                    <TableCell align="right">Assigned</TableCell>
                    <TableCell align="right">Unassigned</TableCell>
                    <TableCell align="right">Regions</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pagedRows.map(row => (
                    <TableRow key={row.loadGroupKey} hover selected={selectedKeys.includes(row.loadGroupKey)}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedKeys.includes(row.loadGroupKey)}
                          disabled={deleting}
                          onChange={() => actions.toggleHistoryLoadGroupSelection(row.loadGroupKey)}
                        />
                      </TableCell>
                      <TableCell>{row.date}</TableCell>
                      <TableCell>{row.field}</TableCell>
                      <TableCell>{row.source}</TableCell>
                      <TableCell align="right">{row.totalLoads}</TableCell>
                      <TableCell align="right">{row.assignedLoads}</TableCell>
                      <TableCell align="right">{row.unassignedLoads}</TableCell>
                      <TableCell align="right">{row.regionIds.length}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end" useFlexGap flexWrap="wrap">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={deleting}
                            onClick={() => actions.openDrawModalForLoadGroups([ row.loadGroupKey ], 'load')}
                          >
                            Draw
                          </Button>
                          {state.auth.admin && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              disabled={deleting}
                              onClick={() => void actions.deleteHistoryLoadGroups([ row.loadGroupKey ])}
                            >
                              Delete
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
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
      </Box>
    </Modal>
  );
});

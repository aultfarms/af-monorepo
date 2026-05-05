import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { context } from './state';

export const SourceManagementModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const { sourceModalOpen, saving, sources, sourceDraft } = state.lookupManagement;

  return (
    <Modal open={sourceModalOpen} onClose={() => !saving && actions.closeSourceManagementModal()}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(900px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        bgcolor: 'white',
        p: 3,
        boxSizing: 'border-box',
      }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 3 }}>
          <Box>
            <Typography variant="h6">Manage Sources</Typography>
            <Typography variant="body2" color="text.secondary">
              Admins can edit the lookup list used by the source dropdown here.
            </Typography>
          </Box>
          <Button variant="outlined" onClick={actions.closeSourceManagementModal} disabled={saving}>
            Close
          </Button>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
          <Typography variant="subtitle1">Sources</Typography>
          <Button variant="contained" onClick={() => void actions.saveManagedSources()} disabled={saving}>
            Save Sources
          </Button>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr 1fr 1fr auto' }, gap: 2, mb: 2, alignItems: 'center' }}>
          <TextField
            label="Name"
            value={sourceDraft.name}
            onChange={event => actions.sourceManagementDraft({ name: event.target.value })}
            disabled={saving}
          />
          <TextField
            select
            label="Type"
            value={sourceDraft.type}
            onChange={event => actions.sourceManagementDraft({ type: event.target.value as 'solid' | 'liquid' })}
            disabled={saving}
          >
            <MenuItem value="solid">Solid</MenuItem>
            <MenuItem value="liquid">Liquid</MenuItem>
          </TextField>
          <TextField
            label="Ac/Load"
            type="number"
            value={sourceDraft.acPerLoad}
            onChange={event => actions.sourceManagementDraft({ acPerLoad: event.target.value })}
            disabled={saving}
          />
          <TextField
            label="Width (ft)"
            type="number"
            value={sourceDraft.spreadWidthFeet}
            onChange={event => actions.sourceManagementDraft({ spreadWidthFeet: event.target.value })}
            disabled={saving}
          />
          <TextField
            label="Load length (ft)"
            type="number"
            value={sourceDraft.defaultLoadLengthFeet}
            onChange={event => actions.sourceManagementDraft({ defaultLoadLengthFeet: event.target.value })}
            disabled={saving}
          />
          <Button variant="outlined" onClick={actions.addManagedSource} disabled={saving}>
            Add
          </Button>
        </Box>

        {sources.length === 0 ? (
          <Typography color="text.secondary">No sources configured.</Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Ac/Load</TableCell>
                  <TableCell>Width (ft)</TableCell>
                  <TableCell>Load length (ft)</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sources.map((source, index) => {
                  const rowKey = source.id || source.name.trim().toLowerCase() || `source-${index}`;
                  return (
                    <TableRow key={rowKey}>
                      <TableCell sx={{ minWidth: 220 }}>
                        <TextField
                          value={source.name}
                          onChange={event => actions.updateManagedSource(rowKey, { name: event.target.value })}
                          fullWidth
                          size="small"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 140 }}>
                        <TextField
                          select
                          value={source.type}
                          onChange={event => actions.updateManagedSource(rowKey, { type: event.target.value as 'solid' | 'liquid' })}
                          fullWidth
                          size="small"
                          disabled={saving}
                        >
                          <MenuItem value="solid">Solid</MenuItem>
                          <MenuItem value="liquid">Liquid</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell sx={{ minWidth: 140 }}>
                        <TextField
                          type="number"
                          value={source.acPerLoad}
                          onChange={event => actions.updateManagedSource(rowKey, { acPerLoad: Number.parseFloat(event.target.value) })}
                          fullWidth
                          size="small"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 140 }}>
                        <TextField
                          type="number"
                          value={source.spreadWidthFeet ?? ''}
                          onChange={event => actions.updateManagedSource(rowKey, { spreadWidthFeet: Number.parseFloat(event.target.value) })}
                          fullWidth
                          size="small"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 160 }}>
                        <TextField
                          type="number"
                          value={source.defaultLoadLengthFeet ?? ''}
                          onChange={event => actions.updateManagedSource(rowKey, { defaultLoadLengthFeet: Number.parseFloat(event.target.value) })}
                          fullWidth
                          size="small"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton onClick={() => actions.deleteManagedSource(rowKey)} disabled={saving}>
                          <DeleteOutlineIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>
    </Modal>
  );
});

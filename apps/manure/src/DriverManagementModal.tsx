import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Box,
  Button,
  IconButton,
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

export const DriverManagementModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const { driverModalOpen, saving, drivers, driverDraft } = state.lookupManagement;

  return (
    <Modal open={driverModalOpen} onClose={() => !saving && actions.closeDriverManagementModal()}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(720px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        bgcolor: 'white',
        p: 3,
        boxSizing: 'border-box',
      }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 3 }}>
          <Box>
            <Typography variant="h6">Manage Drivers</Typography>
            <Typography variant="body2" color="text.secondary">
              Admins can edit the lookup list used by the driver dropdown here.
            </Typography>
          </Box>
          <Button variant="outlined" onClick={actions.closeDriverManagementModal} disabled={saving}>
            Close
          </Button>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
          <Typography variant="subtitle1">Drivers</Typography>
          <Button variant="contained" onClick={() => void actions.saveManagedDrivers()} disabled={saving}>
            Save Drivers
          </Button>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr auto' }, gap: 2, mb: 2, alignItems: 'center' }}>
          <TextField
            label="Name"
            value={driverDraft.name}
            onChange={event => actions.driverManagementDraft({ name: event.target.value })}
            disabled={saving}
          />
          <Button variant="outlined" onClick={actions.addManagedDriver} disabled={saving}>
            Add
          </Button>
        </Box>

        {drivers.length === 0 ? (
          <Typography color="text.secondary">No drivers configured.</Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {drivers.map((driver, index) => {
                  const rowKey = driver.id || driver.name.trim().toLowerCase() || `driver-${index}`;
                  return (
                    <TableRow key={rowKey}>
                      <TableCell sx={{ minWidth: 260 }}>
                        <TextField
                          value={driver.name}
                          onChange={event => actions.updateManagedDriver(rowKey, { name: event.target.value })}
                          fullWidth
                          size="small"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton onClick={() => actions.deleteManagedDriver(rowKey)} disabled={saving}>
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

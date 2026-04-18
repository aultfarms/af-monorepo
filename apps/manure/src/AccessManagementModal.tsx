import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { context } from './state';

export const AccessManagementModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const { modalOpen, loading, saving, records, draft } = state.accessManagement;

  return (
    <Modal open={modalOpen} onClose={() => !saving && actions.closeAccessManagementModal()}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(1100px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        bgcolor: 'white',
        p: 3,
        boxSizing: 'border-box',
      }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box>
            <Typography variant="h6">Manage Access</Typography>
            <Typography variant="body2" color="text.secondary">
              Admins can grant manure access and admin permissions here.
            </Typography>
          </Box>
          <Button variant="outlined" onClick={actions.closeAccessManagementModal} disabled={saving}>
            Close
          </Button>
        </Box>

        <Box sx={{ border: '1px solid #ddd', borderRadius: 1, p: 2, mb: 3 }}>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Add or update access</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 2fr' }, gap: 2, mb: 2 }}>
            <TextField
              label="Email"
              value={draft.email}
              onChange={event => actions.accessManagementDraft({ email: event.target.value })}
              fullWidth
              disabled={saving}
            />
            <TextField
              label="Display name"
              value={draft.displayName}
              onChange={event => actions.accessManagementDraft({ displayName: event.target.value })}
              fullWidth
              disabled={saving}
            />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={draft.enabled}
                  onChange={event => actions.accessManagementDraft({ enabled: event.target.checked })}
                  disabled={saving}
                />
              )}
              label="Enabled"
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={draft.admin}
                  onChange={event => actions.accessManagementDraft({ admin: event.target.checked })}
                  disabled={saving}
                />
              )}
              label="Admin"
            />
            <Button
              variant="contained"
              color="primary"
              onClick={() => void actions.createManagedAccessRecord()}
              disabled={saving}
            >
              Save access
            </Button>
          </Box>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your own access can still be renamed here, but it cannot be disabled, stripped of admin rights, or deleted while you are signed in.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : records.length === 0 ? (
          <Typography color="text.secondary">No access records found.</Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Display name</TableCell>
                  <TableCell>Enabled</TableCell>
                  <TableCell>Admin</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map(record => {
                  const isCurrentUser = record.email === state.auth.email.trim().toLowerCase();
                  return (
                    <TableRow key={record.email}>
                      <TableCell>
                        {record.email}
                        {isCurrentUser ? ' (you)' : ''}
                      </TableCell>
                      <TableCell sx={{ minWidth: 220 }}>
                        <TextField
                          value={record.displayName || ''}
                          onChange={event => actions.updateManagedAccessRecord(record.email, { displayName: event.target.value })}
                          fullWidth
                          size="small"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={record.enabled}
                          onChange={event => actions.updateManagedAccessRecord(record.email, { enabled: event.target.checked })}
                          disabled={saving || isCurrentUser}
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={record.admin}
                          onChange={event => actions.updateManagedAccessRecord(record.email, { admin: event.target.checked })}
                          disabled={saving || isCurrentUser}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => void actions.saveManagedAccessRecord(record.email)}
                            disabled={saving}
                          >
                            Save
                          </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            onClick={() => void actions.deleteManagedAccessRecord(record.email)}
                            disabled={saving || isCurrentUser}
                          >
                            Delete
                          </Button>
                        </Box>
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

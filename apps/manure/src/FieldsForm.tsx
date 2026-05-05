import React from 'react';
import { observer } from 'mobx-react-lite';
import { context } from './state';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Modal,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import CloseIcon from '@mui/icons-material/Close';
import TimelineIcon from '@mui/icons-material/Timeline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CropFreeIcon from '@mui/icons-material/CropFree';
import { useDropzone } from 'react-dropzone';

export const FieldsForm = observer(() => {
  const { state, actions } = React.useContext(context);
  const [editMode, setEditMode] = React.useState(false);
  const [fieldPendingDelete, setFieldPendingDelete] = React.useState<string | null>(null);
  const open = state.mode === 'fields';
  const pendingBoundaryFieldNames = React.useMemo(
    () => new Set(state.pendingBoundaryFieldNames),
    [state.pendingBoundaryFieldNames],
  );
  const handleClose = React.useCallback(() => {
    setEditMode(false);
    setFieldPendingDelete(null);
    actions.mode('loads');
  }, [actions]);
  const pendingDeleteUsage = React.useMemo(() => {
    if (!fieldPendingDelete) {
      return null;
    }

    return {
      currentLoadCount: state.loads.filter(load => load.field === fieldPendingDelete).length,
      previousLoadCount: state.previousLoads.filter(load => load.field === fieldPendingDelete).length,
      regionCount: state.regions.filter(region => region.field === fieldPendingDelete && !region.supersededByRegionId).length,
    };
  }, [fieldPendingDelete, state.loads, state.previousLoads, state.regions]);
  const handleConfirmDelete = React.useCallback(() => {
    if (!fieldPendingDelete) {
      return;
    }
    actions.deleteField(fieldPendingDelete);
    setFieldPendingDelete(null);
  }, [actions, fieldPendingDelete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/vnd.google-earth.kmz': ['.kmz'] },
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        actions.uploadKMZ(acceptedFiles[0]);
      }
    },
  });

  return (
    <React.Fragment>
      <Modal open={open} onClose={handleClose}>
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(1100px, calc(100vw - 24px))',
            height: 'min(90vh, 900px)',
            bgcolor: 'background.paper',
            borderRadius: 2,
            boxShadow: 24,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Box>
              <Typography variant="h6">Field manager</Typography>
              <Typography variant="body2" color="text.secondary">
                Default heading degrees are used as the starting row direction when drawing a load for that field.
              </Typography>
            </Box>
            <IconButton onClick={handleClose}>
              <CloseIcon />
            </IconButton>
          </Stack>

          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, flex: '1 0 auto', bgcolor: '#f5f5f5' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <Button
                onClick={() => setEditMode(!editMode)}
                variant="outlined"
                color="primary"
              >
                {editMode ? 'Disable Edit' : 'Enable Edit'}
              </Button>
              {editMode && (
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => {
                    setEditMode(true);
                    actions.addField();
                  }}
                >
                  Add Field
                </Button>
              )}
              {state.fieldsChanged && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={() => void actions.saveFields()}
                >
                  Save Fields
                </Button>
              )}
            </Stack>

            <Box
              {...getRootProps()}
              sx={{
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                textAlign: 'center',
                bgcolor: isDragActive ? 'action.hover' : 'background.paper',
              }}
            >
              <input {...getInputProps()} />
              <Typography variant="body2">
                {isDragActive ? 'Drop the KMZ file here...' : 'Drag and drop a KMZ file here, or click to select one'}
              </Typography>
            </Box>

            <Box sx={{ overflowX: 'auto', overflowY: 'visible', flexShrink: 0, bgcolor: 'background.paper', borderRadius: 1 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell width="28%">Name</TableCell>
                    <TableCell width="27%">Responsible party</TableCell>
                    <TableCell width="15%">Acres</TableCell>
                    <TableCell width="20%">Default heading°</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.fields.map((field, index) => (
                    <TableRow key={`fields-mgr-${field.name}-${index}`} style={{ backgroundColor: state.editingField === field.name ? '#e0e0e0' : 'inherit' }}>
                      <TableCell>
                        {!editMode
                          ? (
                            <Box>
                              <div>{field.name}</div>
                              {pendingBoundaryFieldNames.has(field.name) && (
                                <Typography variant="caption" color="warning.main">
                                  Boundary needed before saving
                                </Typography>
                              )}
                            </Box>
                          )
                          : (
                            <Stack spacing={0.5}>
                              <TextField
                                style={{ width: '100%' }}
                                value={field.name}
                                onChange={(e) => editMode && actions.fieldName(field.name, e.target.value)}
                              />
                              {pendingBoundaryFieldNames.has(field.name) && (
                                <Typography variant="caption" color="warning.main">
                                  Boundary needed before saving
                                </Typography>
                              )}
                            </Stack>
                          )}
                      </TableCell>
                      <TableCell>
                        {!editMode
                          ? field.responsibleParty
                          : (
                            <TextField
                              style={{ width: '100%' }}
                              value={field.responsibleParty}
                              onChange={(event) => actions.fieldResponsibleParty(field.name, event.target.value)}
                            />
                          )}
                      </TableCell>
                      <TableCell>
                        {!editMode
                          ? field.acreage.toFixed(2)
                          : (
                            <TextField
                              style={{ width: '100%' }}
                              type="number"
                              value={field.acreage}
                              onChange={(event) => {
                                const value = event.target.value.trim();
                                if (!value) {
                                  return;
                                }

                                actions.fieldAcreage(field.name, Number.parseFloat(value));
                              }}
                              inputProps={{ step: 0.01, min: 0 }}
                            />
                          )}
                      </TableCell>
                      <TableCell>
                        {!editMode
                          ? (typeof field.defaultHeadingDegrees === 'number' ? field.defaultHeadingDegrees : '')
                          : (
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <TextField
                                style={{ width: '100%' }}
                                type="number"
                                value={field.defaultHeadingDegrees ?? ''}
                                onChange={(event) => {
                                  const value = event.target.value.trim();
                                  actions.fieldDefaultHeadingDegrees(
                                    field.name,
                                    value === '' ? undefined : Number.parseFloat(value),
                                  );
                                }}
                              />
                              <Tooltip title="Set heading from map">
                                <span>
                                  <IconButton onClick={() => actions.openDrawModalForFieldHeading(field.name)}>
                                    <TimelineIcon />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Stack>
                          )}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          {editMode && (
                            <Tooltip title={pendingBoundaryFieldNames.has(field.name) ? 'Draw boundary' : 'Edit boundary'}>
                              <span>
                                <IconButton onClick={() => actions.openDrawModalForFieldBoundary(field.name)}>
                                  <CropFreeIcon />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                          <Tooltip title="Zoom to field">
                            <span>
                              <IconButton onClick={() => actions.moveMapToField(field.name)}>
                                <GpsFixedIcon />
                              </IconButton>
                            </span>
                          </Tooltip>
                          {editMode && (
                            <Tooltip title="Delete field">
                              <span>
                                <IconButton color="error" onClick={() => setFieldPendingDelete(field.name)}>
                                  <DeleteOutlineIcon />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        </Box>
      </Modal>
      <Dialog open={!!fieldPendingDelete} onClose={() => setFieldPendingDelete(null)}>
        <DialogTitle>Delete field?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {fieldPendingDelete
              ? `Remove "${fieldPendingDelete}" from the field manager?`
              : 'Remove this field from the field manager?'}
          </DialogContentText>
          <DialogContentText sx={{ mt: 1.5 }}>
            This removes the field boundary and default heading from the editable field list. Existing loads and saved regions that already use this field name are not deleted.
          </DialogContentText>
          {pendingDeleteUsage && (
            <DialogContentText sx={{ mt: 1.5 }}>
              References found: {pendingDeleteUsage.currentLoadCount} current-season load{pendingDeleteUsage.currentLoadCount === 1 ? '' : 's'}, {pendingDeleteUsage.previousLoadCount} previous load{pendingDeleteUsage.previousLoadCount === 1 ? '' : 's'}, {pendingDeleteUsage.regionCount} saved region{pendingDeleteUsage.regionCount === 1 ? '' : 's'}.
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFieldPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete field
          </Button>
        </DialogActions>
      </Dialog>
    </React.Fragment>
  );
});

import React from 'react';
import { observer } from 'mobx-react-lite';
import { context } from './state';
import { Box, Table, TableBody, TableCell, TableHead, TableRow, TextField, Button, IconButton, Typography } from '@mui/material';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import { useDropzone } from 'react-dropzone';

export const FieldsForm = observer(() => {
  const { state, actions } = React.useContext(context);
  const [editMode, setEditMode] = React.useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/vnd.google-earth.kmz': ['.kmz'] },
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        actions.uploadKMZ(acceptedFiles[0]);
      }
    },
  });

  return (
    <Box sx={{ p: 0, width: '100%', height: '100%', boxSizing: 'border-box', bgcolor: '#f5f5f5', overflow: 'auto' }}>
      <Button
        onClick={() => setEditMode(!editMode)}
        variant="outlined"
        color="primary"
        style={{ margin: '5px' }}
      >
        {editMode ? 'Disable Edit' : 'Enable Edit'}
      </Button>
      <div {...getRootProps()} style={{ border: '1px dashed gray', padding: '5px', textAlign: 'center', marginBottom: '5px' }}>
        <input {...getInputProps()} />
        {isDragActive ? <p>Drop the KMZ file here...</p> : <p>Drag 'n' drop a KMZ file here, or click to select one</p>}
      </div>
      { state.fieldsChanged &&
        <div style={{ display: 'flex', flexDirection: 'row', width: '100%' }}>
          <Button variant="contained" color="secondary"
            onClick={() => void actions.saveFields()} style={{ margin: '5px', width: '100%' }}
          >
            Save Fields
          </Button>
        </div>
      }
      <Typography variant="body2" color="text.secondary" sx={{ px: 1, pb: 1 }}>
        Default heading degrees are used as the starting row direction when drawing a load for that field.
      </Typography>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell width="45%">Name</TableCell>
            <TableCell width="20%">Acres</TableCell>
            <TableCell width="25%">Default heading°</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {state.fields.map((field, index) => (
            <TableRow key={'fields-mgr-'+index} style={{ backgroundColor: state.editingField === field.name ? '#e0e0e0' : 'inherit' }}>
              <TableCell>
                { !editMode
                ? <div>{field.name}</div>
                : <TextField
                    style={{width: '100%'}}
                    value={field.name}
                    onChange={(e) => editMode && actions.fieldName(field.name, e.target.value)}
                  />
                }
              </TableCell>
              <TableCell>{field.acreage.toFixed(2)}</TableCell>
              <TableCell>
                {!editMode
                  ? (typeof field.defaultHeadingDegrees === 'number' ? field.defaultHeadingDegrees : '')
                  : (
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
                  )}
              </TableCell>
              <TableCell>
                <IconButton onClick={() => actions.moveMapToField(field.name)}>
                  <GpsFixedIcon />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
});
import React from 'react';
import { observer } from 'mobx-react-lite';
import { context } from './state';
import { Modal, Box, Typography, Input } from '@mui/material';

export const ConfigModal = observer(() => {
  const { state, actions } = React.useContext(context);

  return (
    <Modal open={state.config.modalOpen} onClose={actions.toggleConfigModal}>
      <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'white', p: 4 }}>
        <Typography variant="h6">Upload KMZ</Typography>
        <Input
          type="file"
          onChange={event => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) {
              actions.uploadKMZ(file);
            }
          }}
        />
      </Box>
    </Modal>
  );
});

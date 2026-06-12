import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, Modal, Stack, Typography } from '@mui/material';
import { context } from './state';

export const RestoreBackupModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const { restoreModalOpen, restoring, restoreFileName, restoreSummary, restoreError } = state.migration;

  return (
    <Modal open={restoreModalOpen} onClose={() => !restoring && actions.closeRestoreBackupModal()}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 24,
          p: 3,
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Typography variant="h6">Restore manure backup</Typography>
        <Typography variant="body2" color="text.secondary">
          Choose a ZIP backup created by this app. Restoring replaces manure model metadata and manure year data, but does not change access records.
        </Typography>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              void actions.restoreManureBackupFile(file);
            }
          }}
        />
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            variant="contained"
            disabled={restoring}
            onClick={() => inputRef.current?.click()}
          >
            {restoring ? 'Restoring…' : 'Choose backup ZIP'}
          </Button>
          <Button
            variant="outlined"
            disabled={restoring}
            onClick={actions.closeRestoreBackupModal}
          >
            Close
          </Button>
        </Stack>
        {restoreFileName && (
          <Typography variant="body2">
            Selected file: {restoreFileName}
          </Typography>
        )}
        {restoreSummary && (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Backup manifest</Typography>
            <Typography variant="body2">Created: {restoreSummary.createdAt}</Typography>
            <Typography variant="body2">Project: {restoreSummary.projectId}</Typography>
            <Typography variant="body2">Created by: {restoreSummary.adminEmail}</Typography>
            <Typography variant="body2">App version: {restoreSummary.appVersion}</Typography>
            <Typography variant="body2">
              Model version: {restoreSummary.currentVersion || 'legacy'} → {restoreSummary.targetVersion || 'current'}
            </Typography>
            <Typography variant="body2">
              Years: {restoreSummary.yearIds.length > 0 ? restoreSummary.yearIds.join(', ') : 'none'}
            </Typography>
            <Typography variant="body2">Collections: {restoreSummary.collectionCount}</Typography>
          </Box>
        )}
        {restoreError && (
          <Typography variant="body2" color="error">
            {restoreError}
          </Typography>
        )}
      </Box>
    </Modal>
  );
});

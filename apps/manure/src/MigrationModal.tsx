import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, Modal, Stack, Typography } from '@mui/material';
import { context } from './state';

export const MigrationModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const migration = state.migration;
  const migrationModalOpen = state.auth.admin && (
    migration.modalOpen
    || migration.running
    || migration.backingUp
  );
  const busy = migration.running || migration.backingUp || migration.restoring;

  return (
    <Modal open={migrationModalOpen} onClose={() => undefined}>
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
          width: 'min(760px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Typography variant="h6">Database migration required</Typography>
        <Typography variant="body2" color="text.secondary">
          Upgrade the manure data model before loading the app.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {migration.currentVersion || 'legacy'} → {migration.targetVersion || 'current'}
        </Typography>
        {migration.pendingVersions.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            Pending migration{migration.pendingVersions.length === 1 ? '' : 's'}: {migration.pendingVersions.join(', ')}
          </Typography>
        )}
        {migration.backupDownloaded && migration.backupFileName && (
          <Typography variant="body2" color="success.main">
            Backup downloaded: {migration.backupFileName}
          </Typography>
        )}
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'grey.50',
            p: 1.5,
            minHeight: 180,
            maxHeight: 320,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            whiteSpace: 'pre-wrap',
          }}
        >
          {migration.logs.length > 0
            ? migration.logs.join('\n')
            : 'No migration logs yet.'}
        </Box>
        {migration.error && (
          <Typography variant="body2" color="error">
            {migration.error}
          </Typography>
        )}
        <Stack direction="row" spacing={1} justifyContent="flex-end" useFlexGap flexWrap="wrap">
          <Button
            variant="outlined"
            onClick={() => void actions.downloadManureMigrationBackup()}
            disabled={busy}
          >
            {migration.backingUp ? 'Downloading backup…' : 'Download backup'}
          </Button>
          <Button
            variant="outlined"
            color="warning"
            onClick={actions.openRestoreBackupModal}
            disabled={busy}
          >
            Restore from backup
          </Button>
          <Button
            variant="contained"
            onClick={() => void actions.runPendingMigrationUpgrade()}
            disabled={busy}
          >
            {migration.running ? 'Running migration…' : 'Run migration'}
          </Button>
        </Stack>
      </Box>
    </Modal>
  );
});

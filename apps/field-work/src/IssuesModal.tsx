import React from 'react';
import { observer } from 'mobx-react-lite';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { context } from './state';

export const IssuesModal = observer(() => {
  const { state, actions } = React.useContext(context);

  return (
    <Dialog open={state.issuesModalOpen} onClose={actions.closeIssuesModal} fullWidth maxWidth="md">
      <DialogTitle>
        {`Issues${state.issues.length > 0 ? ` (${state.issues.length})` : ''}`}
      </DialogTitle>
      <DialogContent dividers>
        {state.issues.length < 1
          ? (
              <Typography color="text.secondary">
                No issues have been recorded for this session.
              </Typography>
            )
          : (
              <Stack spacing={2}>
                {state.issues.map(issue => (
                  <Alert key={issue.key} severity={issue.level} variant="outlined">
                    <Typography variant="subtitle2">
                      {`${issue.source === 'board' ? 'Board issue' : 'Runtime issue'}${issue.count > 1 ? ` • seen ${issue.count} times` : ''}`}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {issue.message}
                    </Typography>
                  </Alert>
                ))}
              </Stack>
            )}
      </DialogContent>
      <DialogActions>
        <Button onClick={actions.closeIssuesModal}>Close</Button>
      </DialogActions>
    </Dialog>
  );
});

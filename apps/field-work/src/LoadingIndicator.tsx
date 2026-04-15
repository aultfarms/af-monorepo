import { Box, CircularProgress, Fade, Typography } from '@mui/material';

export const LoadingIndicator = () => {
  return (
    <Fade in={true} timeout={300}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          bgcolor: 'rgba(245, 245, 245, 0.9)',
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 2000,
        }}
      >
        <CircularProgress size={56} thickness={4} sx={{ color: '#1976d2' }} />
        <Typography variant="h6" sx={{ mt: 2, color: '#424242' }}>
          Loading...
        </Typography>
      </Box>
    </Fade>
  );
};

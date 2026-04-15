import { Box, CircularProgress, Typography, Fade } from '@mui/material';

export const LoadingIndicator = () => {
  return (
    <Fade in={true} timeout={500}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%', // Fills the parent container
          width: '100%',
          bgcolor: 'rgba(245, 245, 245, 0.9)', // Light gray with slight transparency
          position: 'absolute', // Overlays the content area
          top: 0,
          left: 0,
          zIndex: 2000, // Above map and form
        }}
      >
        <CircularProgress
          size={60} // Larger size for visibility
          thickness={4} // Slightly thinner for elegance
          sx={{ color: '#1976d2' }} // MUI primary blue
        />
        <Typography
          variant="h6"
          sx={{
            mt: 2,
            color: '#424242', // Dark gray for contrast
            fontWeight: 'medium',
          }}
        >
          Loading...
        </Typography>
      </Box>
    </Fade>
  );
};
import('./backend/worker.js').catch((error) => {
  console.error('Failed to start PodSeek backend:', error);
  process.exit(1);
});

require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Brick x Brick backend listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Auth mode: ${process.env.AUTH_MODE || 'stub'}`);
});

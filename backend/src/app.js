const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { errorHandler } = require('./shared/middleware/errorHandler');
const expenseRoutes = require('./expense/routes/expense.routes');

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'brickxbrick-backend', timestamp: new Date().toISOString() });
  });

  // --- Module mounts ---
  // Only the expense module (F6-F8) is wired up right now. Other modules
  // (F1-F5, F9-F12) will each get their own `app.use('/x', xRoutes)` line
  // here as they're built, following this same pattern.
  app.use('/expense', expenseRoutes);

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` });
  });

  // Must be registered last.
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

/**
 * src/middleware/errorHandler.js
 *
 * Express error-handling middleware. Two rules Express relies on:
 *   1. It must be registered LAST in app.js, after every route.
 *   2. It must keep all four arguments (err, req, res, next) — Express
 *      detects an error handler purely by the function having 4 params.
 */

const AppError = require('../errors/AppError');

function errorHandler(err, req, res, next) {
  const isKnown = err instanceof AppError;
  const statusCode = isKnown ? err.statusCode : 500;
  const code = isKnown ? err.code : 'INTERNAL_ERROR';

  if (!isKnown) {
    // Unexpected error (a real bug, not a validation/not-found case) —
    // log the full thing on the server so you can debug it, but don't
    // leak internals to the client.
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: isKnown ? err.message : 'Something went wrong on our end.',
    },
  });
}

module.exports = errorHandler;
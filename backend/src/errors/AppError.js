/**
 * src/errors/AppError.js
 *
 * One error shape for the whole backend. Throw this (or `new AppError(...)`)
 * anywhere in a controller or service, and src/middleware/errorHandler.js
 * will turn it into a consistent JSON response instead of a raw stack
 * trace or a hung request.
 *
 * Example:
 *   if (!ticket) {
 *     throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');
 *   }
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // an "expected" failure, not a bug in the code

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
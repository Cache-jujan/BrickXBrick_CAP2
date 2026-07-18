/**
 * src/middleware/asyncHandler.js
 *
 * Express does NOT automatically catch errors thrown inside an `async`
 * route handler — a rejected promise there just hangs the request
 * forever unless you catch it yourself. This wrapper does that catching
 * for you and forwards any error to errorHandler.js via next(err).
 *
 * Usage:
 *   const asyncHandler = require('../../middleware/asyncHandler');
 *
 *   router.post('/expense/upload', asyncHandler(async (req, res) => {
 *     const result = await OCRService.extract(req.file);
 *     res.json(result);
 *   }));
 */

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
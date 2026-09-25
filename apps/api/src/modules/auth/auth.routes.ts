import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { authenticate } from '../../middleware/authenticate';
import { validateBody } from '../../middleware/validate';
import { NotFoundError } from '../../shared/errors';
import * as authController from './auth.controller';
import { loginSchema, registerSchema } from './auth.schemas';

export const authRouter = Router();

const requireDemoEnabled: RequestHandler = (_req, _res, next) => {
  if (!env.DEMO_LOGIN_ENABLED) throw new NotFoundError('Route not found');
  next();
};

const demoLoginLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many demo login attempts. Please wait a minute and try again.',
        requestId: req.id,
      },
    });
  },
});

authRouter.post('/register', validateBody(registerSchema), authController.register);
authRouter.post('/login', validateBody(loginSchema), authController.login);
authRouter.post('/demo', requireDemoEnabled, demoLoginLimiter, authController.demoLogin);
authRouter.get('/me', authenticate, authController.me);

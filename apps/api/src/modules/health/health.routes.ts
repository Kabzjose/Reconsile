import { Router } from 'express';
import { prisma } from '../../infrastructure/database/prisma';

export const healthRouter = Router();

// Liveness: "is the process up?" No dependencies, so it never flaps because of the database.
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

// Readiness: "can it actually serve traffic?" Checks the database connection.
healthRouter.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch (error) {
    req.log.error({ err: error }, 'Readiness check failed');
    res.status(503).json({ status: 'unavailable' });
  }
});

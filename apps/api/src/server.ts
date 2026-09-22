import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './infrastructure/database/prisma';
import { logger } from './infrastructure/logging/logger';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Reconcile API listening');
});

// Graceful shutdown: stop accepting requests, let in-flight ones finish, close DB connections.
// Platforms send SIGTERM on every deploy; without this, requests get cut off mid-write.
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // If something hangs, don't hang forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

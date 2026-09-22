import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

// Driver-adapter engine: queries run through `pg` + @prisma/adapter-pg, not a native binary.
// One client, and it owns the connection pool, for the whole process.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

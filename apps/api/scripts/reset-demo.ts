import { prisma } from '../src/infrastructure/database/prisma';
import { resetDemoBusiness } from './seed';

async function main() {
  console.log('Resetting demo business...');
  await resetDemoBusiness();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

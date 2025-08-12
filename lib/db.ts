import { PrismaClient } from '@prisma/client'

// إنشاء نسخة واحدة من PrismaClient لتجنب إنشاء اتصالات متعددة
const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// استيراد النوع من Prisma مباشرة
export type { BackupRecord } from '@prisma/client'


import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        const records = await prisma.backupRecord.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });
        res.status(200).json(records);
    } catch (error) {
        console.error("Failed to fetch backup records:", error);
        res.status(500).json({ error: "Failed to fetch backup records" });
    }
}

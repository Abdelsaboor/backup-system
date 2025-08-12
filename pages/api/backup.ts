import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import AWS from 'aws-sdk';
import cron, { ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/db';

type ApiResponseData = { message: string; error?: string; };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponseData>) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // ✅ الحل النهائي: تنظيف كل المدخلات من المسافات الفارغة
        const body = req.body;
        const trimmedBody: { [key: string]: any } = {};
        for (const key in body) {
            trimmedBody[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
        }
        
        const {
            dbType, dbHost, dbPort, dbUser, dbPassword, dbName, dbRequireSsl,
            s3Endpoint, s3BucketName, s3AccessKey, s3SecretKey, s3Region,
            cronExpression
        } = trimmedBody;

        if (!cronExpression) {
            return res.status(400).json({ message: 'Bad Request', error: 'Cron expression is required for scheduled backups.' });
        }

        const performBackup = async () => {
            const record = await prisma.backupRecord.create({
                data: { dbName: dbName, status: 'pending' },
            });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            let fileName = '';
            let dumpCommand = '';
            const env = { ...process.env, PGPASSWORD: dbPassword };

            switch (dbType) {
                case 'postgresql':
                    fileName = `backup-pg-${dbName}-${timestamp}.dump`;
                    const connectionString = `postgresql://${dbUser}:${encodeURIComponent(dbPassword || '')}@${dbHost}:${dbPort}/${dbName}${dbRequireSsl ? '?sslmode=require' : ''}`;
                    dumpCommand = `pg_dump "${connectionString}" -F c --no-password > /tmp/${fileName}`;
                    break;
                default:
                    await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'failed', error: 'Unsupported DB type' } });
                    return;
            }

            exec(dumpCommand, { env }, async (error, stdout, stderr) => {
                if (error) {
                    await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'failed', error: stderr || error.message, completedAt: new Date() } });
                    return;
                }
                
                const filePath = path.join('/tmp', fileName);
                const s3 = new AWS.S3({ endpoint: s3Endpoint, accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey, region: s3Region, s3ForcePathStyle: true });

                try {
                    const fileStream = fs.createReadStream(filePath);
                    await s3.upload({ Bucket: s3BucketName, Key: fileName, Body: fileStream }).promise();
                    const downloadUrl = s3.getSignedUrl('getObject', { Bucket: s3BucketName, Key: fileName, Expires: 3600 * 24 });
                    await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'completed', fileName, downloadUrl, completedAt: new Date() } });
                } catch (s3Error: any) {
                    await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'failed', error: s3Error.message, completedAt: new Date() } });
                } finally {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                }
            });
        };

        if (cron.validate(cronExpression)) {
            const jobKey = `${dbType}-${dbHost}-${dbName}`;
            const job = cron.schedule(cronExpression, performBackup);
            return res.status(200).json({ message: `Backup for '${dbName}' has been successfully scheduled!` });
        } else {
            return res.status(400).json({ message: 'Invalid Cron Expression' });
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'An internal server error occurred.';
        return res.status(500).json({ message: 'Internal Server Error', error: errorMessage });
    }
}

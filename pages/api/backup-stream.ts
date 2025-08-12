import type { NextApiRequest, NextApiResponse } from 'next';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import AWS from 'aws-sdk';
import { prisma } from '../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        // ✅ الحل النهائي: تنظيف كل المدخلات من المسافات الفارغة
        const query = req.query as { [key: string]: string };
        const trimmedQuery: { [key: string]: any } = {};
        for (const key in query) {
            trimmedQuery[key] = typeof query[key] === 'string' ? query[key].trim() : query[key];
        }

        const {
            dbType, dbHost, dbPort, dbUser, dbPassword, dbName, dbRequireSsl,
            s3Endpoint, s3BucketName, s3AccessKey, s3SecretKey, s3Region
        } = trimmedQuery;

        if (!dbType || !dbName) {
            throw new Error('Database type and name are required.');
        }

        sendEvent({ message: `Starting backup for ${dbType} database: '${dbName}'...` });

        const record = await prisma.backupRecord.create({
            data: { dbName, status: 'pending' },
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let fileName = '';
        let command: string;
        let args: string[];
        const env = { ...process.env, PGPASSWORD: dbPassword };

        switch (dbType) {
            case 'postgresql':
                fileName = `backup-pg-${dbName}-${timestamp}.dump`;
                const connectionString = `postgresql://${dbUser}:${encodeURIComponent(dbPassword || '')}@${dbHost}:${dbPort}/${dbName}${dbRequireSsl === 'true' ? '?sslmode=require' : ''}`;
                command = 'pg_dump';
                args = [connectionString, '-F', 'c', '--no-password'];
                break;
            default:
                throw new Error('Unsupported database type');
        }
        
        const filePath = path.join('/tmp', fileName);
        const backupProcess = spawn(command, args, { env });
        const fileWriteStream = fs.createWriteStream(filePath);
        backupProcess.stdout.pipe(fileWriteStream);

        backupProcess.stderr.on('data', (data) => {
            sendEvent({ message: data.toString().trim() });
        });

        backupProcess.on('close', async (code) => {
            if (code === 0) {
                sendEvent({ message: 'Database dump successful. Now uploading to S3...', status: 'uploading' });
                
                const s3 = new AWS.S3({ endpoint: s3Endpoint, accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey, region: s3Region, s3ForcePathStyle: true });
                try {
                    const fileStream = fs.createReadStream(filePath);
                    await s3.upload({ Bucket: s3BucketName, Key: fileName, Body: fileStream }).promise();
                    
                    const downloadUrl = s3.getSignedUrl('getObject', { Bucket: s3BucketName, Key: fileName, Expires: 3600 });
                    sendEvent({ message: 'Upload complete! ✅', status: 'completed' });
                    await prisma.backupRecord.update({
                        where: { id: record.id },
                        data: { status: 'completed', fileName, downloadUrl, completedAt: new Date() }
                    });

                } catch (s3Error: any) {
                    sendEvent({ message: `S3 Upload failed: ${s3Error.message}`, status: 'failed' });
                    await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'failed', error: s3Error.message, completedAt: new Date() }});
                } finally {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    res.end();
                }
            } else {
                const errorMsg = `Backup process failed. Check credentials and network access.`;
                sendEvent({ message: errorMsg, status: 'failed' });
                await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'failed', error: errorMsg, completedAt: new Date() }});
                res.end();
            }
        });

        backupProcess.on('error', async (err) => {
            const errorMsg = `Failed to start backup process: ${err.message}`;
            sendEvent({ message: errorMsg, status: 'failed' });
            await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'failed', error: errorMsg, completedAt: new Date() }});
            res.end();
        });

    } catch (error: any) {
        sendEvent({ message: `An error occurred: ${error.message}`, status: 'failed' });
        res.end();
    }
}

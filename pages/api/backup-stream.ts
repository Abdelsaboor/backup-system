import type { NextApiRequest, NextApiResponse } from 'next';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PassThrough } from 'stream';

// --- Helper Types and Functions for History Logging ---
type BackupStatus = 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'QUEUED' | 'CANCELLED';
type BackupRecord = {
    id: string;
    dbName: string;
    status: BackupStatus;
    createdAt: string;
    fileName?: string;
    error?: string;
    downloadUrl?: string;
};

const DB_PATH = path.resolve(process.cwd(), 'backup-history.json');

const readRecords = async (): Promise<BackupRecord[]> => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            await fs.promises.writeFile(DB_PATH, JSON.stringify([]), 'utf-8');
            return [];
        }
        const fileContent = await fs.promises.readFile(DB_PATH, 'utf-8');
        return fileContent ? JSON.parse(fileContent) : [];
    } catch (error) {
        console.error("Error reading backup history:", error);
        return [];
    }
};

const writeRecords = async (records: BackupRecord[]): Promise<void> => {
    try {
        await fs.promises.writeFile(DB_PATH, JSON.stringify(records, null, 2), 'utf-8');
    } catch (error) {
        console.error("Error writing backup history:", error);
    }
};

// --- Main API Handler ---
const sendStreamMessage = (res: NextApiResponse, data: object) => {
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
        console.error("Failed to write to stream:", e);
    }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const {
        dbHost, dbPort, dbUser, dbPassword, dbName, dbRequireSsl,
        s3Endpoint, s3BucketName, s3AccessKey, s3SecretKey, s3Region
    } = req.query;

    const recordId = randomUUID();
    // ✅ **التعديل: تغيير امتداد الملف إلى .dump**
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${dbName as string}_${timestamp}.dump`;
    
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const backupFilePath = path.join(backupsDir, backupFileName);
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);

    const newRecord: BackupRecord = { id: recordId, dbName: dbName as string, status: 'PROCESSING', createdAt: new Date().toISOString(), fileName: backupFileName };
    const records = await readRecords();
    records.push(newRecord);
    await writeRecords(records);

    const pgDumpPath = path.resolve(process.cwd(), 'vendor', 'pg_dump.exe');
    if (!fs.existsSync(pgDumpPath)) { /* ... handle error ... */ return; }
    
    const args: string[] = [
        '--format=c', '--blobs', '--verbose',
        `--host=${dbHost}`, `--port=${dbPort}`,
        `--username=${dbUser}`, `--dbname=${dbName}`,
    ];
    
    const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: dbPassword as string, PGSSLMODE: dbRequireSsl === 'true' ? 'require' : 'prefer' };
    const backupProcess = spawn(pgDumpPath, args, { env });

    // ✅ **الجديد هنا: إيقاف العملية عند إغلاق الاتصال**
    req.on('close', async () => {
        console.log("Client disconnected. Terminating backup process...");
        backupProcess.kill(); // Stop the pg_dump process
        const finalRecords = await readRecords();
        const recordIndex = finalRecords.findIndex(r => r.id === recordId);
        if (recordIndex > -1 && finalRecords[recordIndex].status === 'PROCESSING') {
            finalRecords[recordIndex].status = 'CANCELLED';
            finalRecords[recordIndex].error = 'Process cancelled by user.';
            await writeRecords(finalRecords);
        }
        res.end();
    });

    const s3Client = new S3Client({
        endpoint: s3Endpoint as string,
        region: s3Region as string,
        credentials: { accessKeyId: s3AccessKey as string, secretAccessKey: s3SecretKey as string }
    });

    const passThrough = new PassThrough();
    passThrough.pipe(fs.createWriteStream(backupFilePath));

    const s3Upload = new Upload({
        client: s3Client,
        params: { Bucket: s3BucketName as string, Key: backupFileName, Body: passThrough, ContentType: 'application/octet-stream' },
    });

    if (backupProcess.stdout) backupProcess.stdout.pipe(passThrough);

    let errorOutput = '';
    if (backupProcess.stderr) {
        backupProcess.stderr.on('data', (data: Buffer | string) => {
            errorOutput += data.toString();
            sendStreamMessage(res, { message: data.toString().trim() });
        });
    }

    try {
        await s3Upload.done();
        sendStreamMessage(res, { message: "✅ S3 upload completed successfully." });

        // ✅ **الجديد هنا: إنشاء رابط تحميل آمن ومؤقت**
        const command = new GetObjectCommand({ Bucket: s3BucketName as string, Key: backupFileName });
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // Link expires in 1 hour

        const finalRecords = await readRecords();
        const recordIndex = finalRecords.findIndex(r => r.id === recordId);
        if (recordIndex > -1) {
            finalRecords[recordIndex].status = 'COMPLETED';
            finalRecords[recordIndex].downloadUrl = signedUrl; // Save the working link
            await writeRecords(finalRecords);
        }
        sendStreamMessage(res, { message: "All tasks finished.", status: 'completed' });

    } catch (err: any) {
        sendStreamMessage(res, { message: `❌ S3 Upload Failed: ${err.message}`, status: 'failed' });
        const finalRecords = await readRecords();
        const recordIndex = finalRecords.findIndex(r => r.id === recordId);
        if (recordIndex > -1) {
            finalRecords[recordIndex].status = 'FAILED';
            finalRecords[recordIndex].error = `S3 Error: ${err.message}`;
            await writeRecords(finalRecords);
        }
    } finally {
        if (!res.writableEnded) {
            sendStreamMessage(res, { status: 'closed' });
            res.end();
        }
    }
}

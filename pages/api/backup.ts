// 📍 الملف: pages/api/backup.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import AWS from 'aws-sdk';
import cron, { ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';

// هذا الكائن سيحتفظ بالمهام المجدولة لمنع تكرارها عند كل طلب API
const scheduledJobs: { [key: string]: ScheduledTask } = {};
type ApiResponseData = {
    message: string;
    error?: string;
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<ApiResponseData>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const {
            dbType, dbHost, dbPort, dbUser, dbPassword, dbName,
            s3Endpoint, s3BucketName, s3AccessKey, s3SecretKey, s3Region,
            cronExpression
        } = req.body;

        const performBackup = async () => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            let fileName = '';
            let dumpCommand = '';
            // ✅ التصحيح الأول: تغيير let إلى const
            const env = { ...process.env, PGPASSWORD: dbPassword, MYSQL_PWD: dbPassword };

            console.log(`[${new Date().toISOString()}] Starting backup for ${dbType} database: ${dbName}`);

            switch (dbType) {
                case 'postgresql':
                    fileName = `backup-pg-${dbName}-${timestamp}.dump`;
                    dumpCommand = `pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F c -f /tmp/${fileName}`;
                    break;
                case 'mysql':
                    fileName = `backup-mysql-${dbName}-${timestamp}.sql`;
                    dumpCommand = `mysqldump --no-tablespaces -h ${dbHost} -P ${dbPort} -u ${dbUser} --databases ${dbName} > /tmp/${fileName}`;
                    break;
                case 'mongodb':
                    fileName = `backup-mongo-${dbName}-${timestamp}.gz`;
                    const mongoURI = `mongodb://${dbUser}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}?authSource=admin`;
                    dumpCommand = `mongodump --uri="${mongoURI}" --archive=/tmp/${fileName} --gzip`;
                    break;
                default:
                    console.error(`Unsupported database type: ${dbType}`);
                    // من المهم إرسال استجابة خطأ للواجهة الأمامية
                    // ملاحظة: هذه الدالة تعمل في الخلفية لذا لن تصل الاستجابة للمستخدم مباشرة
                    // ولكن من الجيد إضافتها للمستقبل
                    if (!res.headersSent) {
                       res.status(400).json({ message: `Unsupported database type: ${dbType}` });
                    }
                    return;
            }

            exec(dumpCommand, { env }, async (error, stdout, stderr) => {
                if (error) {
                    console.error(`[${dbType} DUMP ERROR]:`, stderr);
                    // هنا يمكن إرسال إشعار للمطور بوجود خطأ
                    return;
                }

                console.log(`Database dump successful: ${fileName}`);
                const filePath = path.join('/tmp', fileName);

                const s3 = new AWS.S3({
                    endpoint: s3Endpoint,
                    accessKeyId: s3AccessKey,
                    secretAccessKey: s3SecretKey,
                    region: s3Region,
                    s3ForcePathStyle: true,
                });

                try {
                    const fileStream = fs.createReadStream(filePath);
                    await s3.upload({ Bucket: s3BucketName, Key: fileName, Body: fileStream }).promise();
                    console.log(`Backup file successfully uploaded to S3: ${fileName}`);
                } catch (s3Error) {
                    console.error('[S3 UPLOAD ERROR]:', s3Error);
                } finally {
                    // التأكد من وجود الملف قبل محاولة حذفه لتجنب الأخطاء
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log(`Temporary file deleted: ${filePath}`);
                    }
                }
            });
        };

        if (cronExpression && cron.validate(cronExpression)) {
            const jobKey = `${dbType}-${dbHost}-${dbName}`;
            if (scheduledJobs[jobKey]) {
                scheduledJobs[jobKey].stop();
            }
            const job = cron.schedule(cronExpression, performBackup);
            scheduledJobs[jobKey] = job;
            return res.status(200).json({ message: `Backup for ${dbName} has been successfully scheduled!` });
        } else {
            performBackup();
            return res.status(200).json({ message: 'Backup initiated successfully! Check server logs for progress.' });
        }
    } catch (error: unknown) { // ✅ التصحيح الثاني: تغيير any إلى unknown
        console.error('[API CATCH ERROR]:', error);
        let errorMessage = 'An internal server error occurred.';
        
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        
        return res.status(500).json({ message: 'Internal Server Error', error: errorMessage });
    }
}
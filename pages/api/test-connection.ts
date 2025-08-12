import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
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

        const { dbType, dbHost, dbPort, dbUser, dbPassword, dbName, dbRequireSsl } = trimmedBody;
        if (!dbType || !dbHost || !dbPort || !dbUser) {
            return res.status(400).json({ error: 'Missing required database credentials for testing.' });
        }

        const sslMode = dbRequireSsl ? 'require' : 'prefer';
        const env = { ...process.env, PGPASSWORD: dbPassword, MYSQL_PWD: dbPassword, PGSSLMODE: sslMode };
        let command = '';

        switch (dbType) {
            case 'postgresql':
                command = `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} --quiet -c "SELECT 1;"`;
                break;
            case 'mysql':
                const sslOption = dbRequireSsl ? '--ssl-mode=REQUIRED' : '';
                command = `mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} ${sslOption} -e "SELECT 1;"`;
                break;
            case 'mongodb':
                const mongoURI = `mongodb://${dbUser}:${encodeURIComponent(dbPassword || '')}@${dbHost}:${dbPort}/?authSource=admin&serverSelectionTimeoutMS=5000${dbRequireSsl ? '&ssl=true' : ''}`;
                command = `mongosh "${mongoURI}" --quiet --eval "db.admin().ping()"`;
                break;
            default:
                return res.status(400).json({ error: 'Unsupported database type' });
        }

        exec(command, { env, timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                const cleanError = (stderr || error.message).split('\n')[0].replace('psql: ', '').replace('ERROR: ', '').trim();
                return res.status(500).json({ error: cleanError });
            }
            return res.status(200).json({ message: 'Connection successful' });
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'An unknown error occurred.';
        return res.status(500).json({ error: message });
    }
}

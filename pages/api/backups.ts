import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

// Define a type for our backup records for type safety
type BackupRecord = {
    id: string;
    dbName: string;
    status: 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'QUEUED';
    createdAt: string;
    fileName?: string;
    error?: string;
    downloadUrl?: string;
};

// Define the path to our simple JSON database file
// This file will be created in the root of your project
const DB_PATH = path.resolve(process.cwd(), 'backup-history.json');

/**
 * Reads backup records from the JSON file.
 * Creates the file if it doesn't exist.
 * @returns {Promise<BackupRecord[]>} A promise that resolves to an array of backup records.
 */
const readRecords = async (): Promise<BackupRecord[]> => {
    try {
        // Check if the database file exists
        if (!fs.existsSync(DB_PATH)) {
            // If not, create it with an empty array
            await fs.promises.writeFile(DB_PATH, JSON.stringify([]), 'utf-8');
            return [];
        }
        // If it exists, read and parse it
        const fileContent = await fs.promises.readFile(DB_PATH, 'utf-8');
        // Handle case where file is empty
        return fileContent ? JSON.parse(fileContent) : [];
    } catch (error) {
        console.error("Error reading backup history:", error);
        // Return an empty array in case of any error to prevent crashes
        return [];
    }
};

/**
 * API handler for fetching backup history.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // This endpoint only supports GET requests
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const records = await readRecords();
        // Sort records by date, newest first, to display the latest jobs on top
        const sortedRecords = records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.status(200).json(sortedRecords);
    } catch (error) {
        console.error("API Error fetching history:", error);
        return res.status(500).json({ error: 'Failed to retrieve backup history.' });
    }
}

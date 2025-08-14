import type { NextApiRequest, NextApiResponse } from 'next';
// Import the official Node.js clients for each database
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';

/**
 * Handles testing the connection to a database.
 * This version uses native Node.js drivers instead of command-line tools,
 * which is more reliable, secure, and efficient.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // Extract and validate credentials from the request body
    const { 
        dbType, 
        dbHost, 
        dbPort, 
        dbUser, 
        dbPassword, 
        dbName, 
        dbRequireSsl 
    } = req.body;

    if (!dbType || !dbHost || !dbPort || !dbUser) {
        return res.status(400).json({ error: 'Missing required database credentials for testing.' });
    }

    // Use a switch statement to handle different database types
    switch (dbType) {
        case 'postgresql':
            // Use the 'pg' (node-postgres) client
            const pgClient = new PgClient({
                host: dbHost,
                port: Number(dbPort),
                user: dbUser,
                password: dbPassword,
                database: dbName,
                ssl: dbRequireSsl ? { rejectUnauthorized: false } : false,
                // Set a connection timeout to prevent long waits
                connectionTimeoutMillis: 10000, 
            });

            try {
                await pgClient.connect();
                await pgClient.end();
                return res.status(200).json({ message: 'PostgreSQL connection successful!' });
            } catch (error: any) {
                return res.status(500).json({ error: error.message });
            }

        case 'mysql':
            // Use the 'mysql2' client
            let mysqlConnection;
            try {
                mysqlConnection = await mysql.createConnection({
                    host: dbHost,
                    port: Number(dbPort),
                    user: dbUser,
                    password: dbPassword,
                    database: dbName,
                    ssl: dbRequireSsl ? { rejectUnauthorized: false } : undefined,
                    connectTimeout: 10000,
                });
                await mysqlConnection.end();
                return res.status(200).json({ message: 'MySQL connection successful!' });
            } catch (error: any) {
                return res.status(500).json({ error: error.message });
            } finally {
                if (mysqlConnection) await mysqlConnection.end();
            }

        case 'mongodb':
            // Use the 'mongodb' native driver
            const mongoURI = `mongodb://${dbUser}:${encodeURIComponent(dbPassword || '')}@${dbHost}:${dbPort}/${dbName || ''}?authSource=admin`;
            const mongoClient = new MongoClient(mongoURI, {
                ssl: dbRequireSsl,
                serverSelectionTimeoutMS: 10000, // Timeout for finding a server
            });
            try {
                await mongoClient.connect();
                // The ping command is cheap and does not require auth.
                await mongoClient.db("admin").command({ ping: 1 });
                return res.status(200).json({ message: 'MongoDB connection successful!' });
            } catch (error: any) {
                return res.status(500).json({ error: error.message });
            } finally {
                await mongoClient.close();
            }

        default:
            return res.status(400).json({ error: 'Unsupported database type' });
    }
}

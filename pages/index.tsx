import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Loader2, CheckCircle, XCircle, Wand2, Moon, Sun, ShieldCheck, History } from "lucide-react";
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { BackupRecord } from '../lib/db';

type View = 'form' | 'history';
type Step = 'database' | 's3' | 'schedule';
type Status = 'idle' | 'success' | 'error';

export default function HomePage() {
    const { setTheme, theme } = useTheme();
    const [view, setView] = useState<View>('form');
    const [formData, setFormData] = useState({
        dbType: 'postgresql',
        dbHost: '',
        dbPort: '5432',
        dbUser: '',
        dbPassword: '',
        dbName: '',
        dbRequireSsl: true,
        s3Endpoint: '',
        s3BucketName: '',
        s3AccessKey: '',
        s3SecretKey: '',
        s3Region: 'us-east-1',
        cronExpression: '',
    });
    const [currentStep, setCurrentStep] = useState<Step>('database');
    const [isLoading, setIsLoading] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<Status>('idle');
    const [isBackupInProgress, setIsBackupInProgress] = useState(false);
    const [backupLogs, setBackupLogs] = useState<string[]>([]);
    const [backupStatus, setBackupStatus] = useState<'pending' | 'completed' | 'failed'>('pending');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        setConnectionStatus('idle');
    };

    const handleSelectChange = (value: string) => {
        const ports: { [key: string]: string } = { postgresql: '5432', mysql: '3306', mongodb: '27017' };
        setFormData(prev => ({ ...prev, dbType: value, dbPort: ports[value] || '' }));
        setConnectionStatus('idle');
    };

    const handleTestConnection = async () => {
        setIsTestingConnection(true);
        setConnectionStatus('idle');
        try {
            const response = await fetch('/api/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            const result = await response.json();
            if (response.ok) {
                setConnectionStatus('success');
                toast.success("Connection successful!");
            } else {
                setConnectionStatus('error');
                toast.error("Connection failed.", { description: result.error });
            }
        } catch (error: any) {
            setConnectionStatus('error');
            toast.error("Connection failed.", { description: error?.message || "An unknown error occurred. Check server logs." });
        }
        setIsTestingConnection(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (formData.cronExpression) {
            setIsLoading(true);
            const response = await fetch('/api/backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            const result = await response.json();
            setIsLoading(false);
            if (response.ok) {
                toast.success("Success! 🎉", { description: result.message });
                setView('history');
            } else {
                toast.error("Uh oh! Something went wrong.", { description: result.message });
            }
            return;
        }

        setIsBackupInProgress(true);
        setBackupLogs([]);
        setBackupStatus('pending');

        const eventSource = new EventSource(`/api/backup-stream?${new URLSearchParams(Object.entries(formData).map(([k, v]) => [k, String(v)]))}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setBackupLogs((prevLogs) => [...prevLogs, data.message]);
            if (data.status) {
                setBackupStatus(data.status);
            }
        };

        eventSource.onerror = (err) => {
            toast.error("Connection to backup stream failed.");
            setBackupStatus('failed');
            eventSource.close();
        };
    };

    const renderFormView = () => (
        <Card className="w-full max-w-2xl">
            <form onSubmit={handleSubmit}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-2xl"><Wand2 /> New Backup Configuration</CardTitle>
                    <CardDescription>Follow the steps to configure and schedule your database backup.</CardDescription>
                </CardHeader>
                {currentStep === 'database' && renderDatabaseStep()}
                {currentStep === 's3' && renderS3Step()}
                {currentStep === 'schedule' && renderScheduleStep()}
                <CardFooter className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setCurrentStep(currentStep === 'schedule' ? 's3' : 'database')} disabled={currentStep === 'database'}>Previous</Button>
                    {currentStep !== 'schedule' ? (
                        <Button type="button" onClick={() => setCurrentStep(currentStep === 'database' ? 's3' : 'schedule')}>Next</Button>
                    ) : (
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Schedule / Run Backup
                        </Button>
                    )}
                </CardFooter>
            </form>
        </Card>
    );
    
    const renderDatabaseStep = () => (
        <CardContent className="space-y-6 pt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="dbType">Database Type</Label>
                    <Select onValueChange={handleSelectChange} defaultValue={formData.dbType}>
                        <SelectTrigger id="dbType"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="postgresql">PostgreSQL</SelectItem>
                            <SelectItem value="mysql">MySQL</SelectItem>
                            <SelectItem value="mongodb">MongoDB</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2"><Label htmlFor="dbHost">Host</Label><Input id="dbHost" name="dbHost" value={formData.dbHost} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="dbPort">Port</Label><Input id="dbPort" name="dbPort" value={formData.dbPort} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="dbUser">User</Label><Input id="dbUser" name="dbUser" value={formData.dbUser} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="dbPassword">Password</Label><Input id="dbPassword" name="dbPassword" type="password" value={formData.dbPassword} onChange={handleChange} /></div>
                <div className="space-y-2"><Label htmlFor="dbName">Database Name</Label><Input id="dbName" name="dbName" value={formData.dbName} onChange={handleChange} required /></div>
            </div>
            <div className="flex items-center space-x-2 pt-2">
                <Checkbox id="dbRequireSsl" checked={formData.dbRequireSsl} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, dbRequireSsl: !!checked }))} />
                <label htmlFor="dbRequireSsl" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Require SSL Connection
                </label>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-4 border-t border-border mt-4">
                {connectionStatus === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
                {connectionStatus === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
                <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTestingConnection}>
                    {isTestingConnection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Test Connection
                </Button>
            </div>
        </CardContent>
    );

    const renderS3Step = () => (
        <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="s3Endpoint">S3 Endpoint URL</Label><Input id="s3Endpoint" name="s3Endpoint" value={formData.s3Endpoint} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="s3BucketName">Bucket Name</Label><Input id="s3BucketName" name="s3BucketName" value={formData.s3BucketName} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="s3Region">Region</Label><Input id="s3Region" name="s3Region" value={formData.s3Region} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="s3AccessKey">Access Key</Label><Input id="s3AccessKey" name="s3AccessKey" value={formData.s3AccessKey} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="s3SecretKey">Secret Key</Label><Input id="s3SecretKey" name="s3SecretKey" type="password" value={formData.s3SecretKey} onChange={handleChange} required /></div>
            </div>
        </CardContent>
    );

    const renderScheduleStep = () => (
        <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
                <Label htmlFor="cronExpression">Cron Expression (Optional)</Label>
                <Input id="cronExpression" name="cronExpression" placeholder="e.g., 0 2 * * * (for 2 AM daily)" value={formData.cronExpression} onChange={handleChange} />
                <p className="text-sm text-muted-foreground">Leave empty to run backup once immediately. Use <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer" className="text-primary underline">crontab.guru</a> for help.</p>
            </div>
        </CardContent>
    );

    return (
        <main className="container mx-auto flex min-h-screen flex-col items-center justify-center p-4">
            <div className="absolute top-4 right-4 flex gap-2">
                <Button variant="ghost" onClick={() => setView(view === 'form' ? 'history' : 'form')}>
                    {view === 'form' ? <><History className="mr-2 h-4 w-4"/> View History</> : 'New Backup'}
                </Button>
                <Button variant="outline" size="icon" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
                    <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    <span className="sr-only">Toggle theme</span>
                </Button>
            </div>
            {view === 'form' ? renderFormView() : <HistoryView />}

            <Dialog open={isBackupInProgress} onOpenChange={setIsBackupInProgress}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Backup in Progress...</DialogTitle>
                        <DialogDescription>
                            Please keep this window open until the process is complete.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 h-64 overflow-y-auto rounded-md bg-muted p-4 font-mono text-xs">
                        {backupLogs.map((log, index) => (
                            <p key={index}>{log}</p>
                        ))}
                    </div>
                    <DialogFooter>
                        {backupStatus === 'completed' && <p className="text-green-500">Backup completed successfully!</p>}
                        {backupStatus === 'failed' && <p className="text-red-500">Backup failed. Check logs for details.</p>}
                        <Button onClick={() => setIsBackupInProgress(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}

function HistoryView() {
    const [records, setRecords] = useState<BackupRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchRecords = async () => {
            try {
                const response = await fetch('/api/backups');
                if(response.ok) {
                    const data = await response.json();
                    setRecords(data);
                }
            } catch (error) {
                console.error("Failed to fetch backup records:", error);
                toast.error("Could not fetch backup history.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchRecords();
        
        const interval = setInterval(fetchRecords, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <Card className="w-full max-w-4xl">
            <CardHeader>
                <CardTitle>Backup History</CardTitle>
                <CardDescription>Here is a list of all your recent backup jobs. The list refreshes automatically.</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading && records.length === 0 ? (
                    <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                ) : records.length === 0 ? (
                    <p className="text-center text-muted-foreground p-8">No backup jobs found.</p>
                ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Database</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created At</TableHead>
                            <TableHead>Filename / Error</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {records.map((record) => (
                            <TableRow key={record.id}>
                                <TableCell className="font-medium">{record.dbName}</TableCell>
                                <TableCell>
                                    <Badge variant={record.status === 'completed' ? 'default' : record.status === 'failed' ? 'destructive' : 'secondary'}>
                                        {record.status === 'pending' && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                                        {record.status}
                                    </Badge>
                                </TableCell>
                                <TableCell>{new Date(record.createdAt).toLocaleString()}</TableCell>
                                <TableCell className="text-xs max-w-xs truncate">{record.fileName || record.error}</TableCell>
                                <TableCell className="text-right">
                                    {record.status === 'completed' && record.downloadUrl && (
                                        <Button asChild variant="outline" size="sm">
                                            <a href={record.downloadUrl} target="_blank" rel="noopener noreferrer">Download</a>
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                )}
            </CardContent>
        </Card>
    );
}

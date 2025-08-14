import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Loader2, CheckCircle, XCircle, Wand2, Moon, Sun, ShieldCheck, History, ArrowRight, ArrowLeft, Download, Database, Server, Cloud } from "lucide-react";
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// It's a good practice to define types for complex objects
type BackupRecord = {
    id: string;
    dbName: string;
    status: 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'QUEUED';
    createdAt: string;
    fileName?: string;
    error?: string;
    downloadUrl?: string;
};

// Define a type for the form data to ensure type safety
type BackupFormData = {
    dbType: string;
    dbHost: string;
    dbPort: string;
    dbUser: string;
    dbPassword: string;
    dbName: string;
    dbRequireSsl: boolean;
    s3Endpoint: string;
    s3BucketName: string;
    s3AccessKey: string;
    s3SecretKey: string;
    s3Region: string;
    cronExpression: string;
};

type View = 'form' | 'history';
type Step = 'database' | 's3' | 'schedule';
type ConnectionStatus = 'idle' | 'success' | 'error' | 'testing';

/**
 * Main component for the Backup System UI
 */
export default function HomePage() {
    const { setTheme, theme } = useTheme();
    const [view, setView] = useState<View>('form');

    // State for the main backup form
    const [formData, setFormData] = useState<BackupFormData>({
        dbType: 'postgresql',
        dbHost: '', dbPort: '5432', dbUser: '', dbPassword: '', dbName: '', dbRequireSsl: true,
        s3Endpoint: '', s3BucketName: '', s3AccessKey: '', s3SecretKey: '', s3Region: 'us-east-1',
        cronExpression: '',
    });

    // UI/UX State
    const [currentStep, setCurrentStep] = useState<Step>('database');
    const [isLoading, setIsLoading] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
    
    // State for the real-time backup process modal
    const [isBackupInProgress, setIsBackupInProgress] = useState(false);
    const [backupLogs, setBackupLogs] = useState<string[]>([]);
    const [backupStatus, setBackupStatus] = useState<'pending' | 'completed' | 'failed'>('pending');

    // --- Event Handlers ---

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        // Reset connection status if database details change
        if (name.startsWith('db')) {
            setConnectionStatus('idle');
        }
    };

    const handleSelectChange = (name: string, value: string) => {
        setFormData(prev => ({ ...prev, [name]: value }));
        if (name === 'dbType') {
            const ports: { [key: string]: string } = { postgresql: '5432' };
            setFormData(prev => ({ ...prev, dbPort: ports[value] || '' }));
            setConnectionStatus('idle');
        }
    };

    const handleCheckboxChange = (name: string, checked: boolean) => {
        setFormData(prev => ({ ...prev, [name]: checked }));
         if (name.startsWith('db')) {
            setConnectionStatus('idle');
        }
    };

    // --- API Calls ---

    const handleTestConnection = async () => {
        setConnectionStatus('testing');
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
                toast.error("Connection failed.", { description: result.error || "Please check credentials and network." });
            }
        } catch (error: any) {
            setConnectionStatus('error');
            toast.error("Connection failed.", { description: error?.message || "An unknown error occurred." });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // If cron expression exists, it's a schedule job, not a real-time one
        if (formData.cronExpression) {
            setIsLoading(true);
            try {
                const response = await fetch('/api/backup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData),
                });
                const result = await response.json();
                if (response.ok) {
                    toast.success("Success! 🎉", { description: "Backup job has been scheduled." });
                    setView('history');
                } else {
                    toast.error("Uh oh! Something went wrong.", { description: result.message || result.error });
                }
            } catch (error: any) {
                 toast.error("Failed to schedule backup.", { description: error?.message });
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // --- Start Real-time Backup via Server-Sent Events ---
        setIsBackupInProgress(true);
        setBackupLogs([]);
        setBackupStatus('pending');

        const queryParams = new URLSearchParams();
        // A more type-safe way to append params
        Object.entries(formData).forEach(([key, value]) => {
            queryParams.append(key, String(value));
        });

        const eventSource = new EventSource(`/api/backup-stream?${queryParams.toString()}`);

        eventSource.onopen = () => {
             setBackupLogs(prev => [...prev, "Connection to server established. Starting backup..."]);
        };

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.message) {
                setBackupLogs((prevLogs) => [...prevLogs, data.message]);
            }
            if (data.status) {
                setBackupStatus(data.status);
                if (['completed', 'failed', 'closed'].includes(data.status)) {
                    eventSource.close();
                    if (data.status === 'completed') {
                         toast.success("Backup completed successfully!");
                    } else if (data.status === 'failed') {
                         toast.error("Backup failed.", { description: "Check logs for more details."});
                    }
                }
            }
        };

        eventSource.onerror = (err) => {
            toast.error("Connection to backup stream failed.");
            setBackupStatus('failed');
            setBackupLogs((prev) => [...prev, "Stream connection closed unexpectedly. The server might have terminated the process."]);
            eventSource.close();
        };
    };
    
    // --- Step Navigation ---
    const nextStep = () => {
        if (currentStep === 'database') setCurrentStep('s3');
        if (currentStep === 's3') setCurrentStep('schedule');
    };
    const prevStep = () => {
        if (currentStep === 'schedule') setCurrentStep('s3');
        if (currentStep === 's3') setCurrentStep('database');
    };

    // --- Render Logic ---
    
    const renderStepContent = () => {
        switch(currentStep) {
            case 'database': return <DatabaseStepContent formData={formData} connectionStatus={connectionStatus} onTestConnection={handleTestConnection} onChange={handleChange} onSelectChange={(v: string) => handleSelectChange('dbType', v)} onCheckboxChange={(c: boolean) => handleCheckboxChange('dbRequireSsl', c)} />;
            case 's3': return <S3StepContent formData={formData} onChange={handleChange} />;
            case 'schedule': return <ScheduleStepContent formData={formData} onChange={handleChange} />;
            default: return null;
        }
    };

    return (
        <main className="container mx-auto flex min-h-screen flex-col items-center justify-center p-4">
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <Button variant="outline" onClick={() => setView(view === 'form' ? 'history' : 'form')}>
                    {view === 'form' ? <History className="mr-2 h-4 w-4"/> : <Wand2 className="mr-2 h-4 w-4" />}
                    {view === 'form' ? 'View History' : 'New Backup'}
                </Button>
                <Button variant="outline" size="icon" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
                    <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    <span className="sr-only">Toggle theme</span>
                </Button>
            </div>
            
            {view === 'form' ? (
                <Card className="w-full max-w-2xl animate-in fade-in-50 duration-500">
                    <form onSubmit={handleSubmit}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-2xl"><ShieldCheck /> Secure Backup System</CardTitle>
                            <CardDescription>Configure and run a secure, one-time or scheduled database backup.</CardDescription>
                        </CardHeader>
                        
                        {renderStepContent()}

                        <CardFooter className="flex justify-between">
                            <Button type="button" variant="outline" onClick={prevStep} disabled={currentStep === 'database'}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Previous
                            </Button>
                            {currentStep !== 'schedule' ? (
                                <Button type="button" onClick={nextStep} disabled={currentStep === 'database' && connectionStatus !== 'success'}>
                                    Next <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            ) : (
                                <Button type="submit" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {formData.cronExpression ? 'Schedule Backup' : 'Run Backup Now'}
                                </Button>
                            )}
                        </CardFooter>
                    </form>
                </Card>
            ) : (
                <HistoryView />
            )}

            {/* Real-time Backup Progress Modal */}
            <Dialog open={isBackupInProgress} onOpenChange={setIsBackupInProgress}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Backup in Progress...</DialogTitle>
                        <DialogDescription>Please keep this window open until the process is complete. Logs are streamed from the server.</DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 h-64 overflow-y-auto rounded-md bg-muted p-4 font-mono text-xs selection:bg-primary selection:text-primary-foreground">
                        {backupLogs.map((log, index) => (<p key={index} className="whitespace-pre-wrap">{log}</p>))}
                    </div>
                    <DialogFooter className="sm:justify-between">
                        <div className="flex items-center gap-2">
                             {backupStatus === 'completed' && <><CheckCircle className="h-5 w-5 text-green-500" /><p className="text-sm text-green-500">Backup completed successfully!</p></>}
                             {backupStatus === 'failed' && <><XCircle className="h-5 w-5 text-red-500" /><p className="text-sm text-red-500">Backup failed. Check logs for details.</p></>}
                             {backupStatus === 'pending' && <><Loader2 className="h-5 w-5 animate-spin" /><p className="text-sm text-muted-foreground">Processing...</p></>}
                        </div>
                        <Button onClick={() => { setIsBackupInProgress(false); if (backupStatus !== 'pending') setView('history'); }}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}

// --- Sub-components for Form Steps with defined Prop Types ---

type DatabaseStepProps = {
    formData: BackupFormData;
    connectionStatus: ConnectionStatus;
    onTestConnection: () => void;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSelectChange: (value: string) => void;
    onCheckboxChange: (checked: boolean) => void;
};

const DatabaseStepContent = ({ formData, connectionStatus, onTestConnection, onChange, onSelectChange, onCheckboxChange }: DatabaseStepProps) => (
    <CardContent className="space-y-6 pt-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
                <Label htmlFor="dbType">Database Type</Label>
                <Select onValueChange={onSelectChange} defaultValue={formData.dbType}>
                    <SelectTrigger id="dbType"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="postgresql">PostgreSQL</SelectItem></SelectContent>
                </Select>
            </div>
            <div className="space-y-2"><Label htmlFor="dbHost">Host</Label><Input id="dbHost" name="dbHost" value={formData.dbHost} onChange={onChange} placeholder="e.g., db.example.com" required /></div>
            <div className="space-y-2"><Label htmlFor="dbPort">Port</Label><Input id="dbPort" name="dbPort" value={formData.dbPort} onChange={onChange} required /></div>
            <div className="space-y-2"><Label htmlFor="dbUser">User</Label><Input id="dbUser" name="dbUser" value={formData.dbUser} onChange={onChange} placeholder="e.g., backup_user" required /></div>
            <div className="space-y-2"><Label htmlFor="dbPassword">Password</Label><Input id="dbPassword" name="dbPassword" type="password" value={formData.dbPassword} onChange={onChange} /></div>
            <div className="space-y-2"><Label htmlFor="dbName">Database Name</Label><Input id="dbName" name="dbName" value={formData.dbName} onChange={onChange} placeholder="e.g., production_db" required /></div>
        </div>
        <div className="flex items-center space-x-2 pt-2">
            <Checkbox id="dbRequireSsl" checked={formData.dbRequireSsl} onCheckedChange={onCheckboxChange} />
            <label htmlFor="dbRequireSsl" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Require SSL Connection</label>
        </div>
        <div className="flex items-center justify-end space-x-2 pt-4 border-t mt-4">
            {connectionStatus === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
            {connectionStatus === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
            <Button type="button" variant="outline" onClick={onTestConnection} disabled={connectionStatus === 'testing'}>
                {connectionStatus === 'testing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Test Connection
            </Button>
        </div>
    </CardContent>
);

type S3StepProps = {
    formData: BackupFormData;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

const S3StepContent = ({ formData, onChange }: S3StepProps) => (
    <CardContent className="space-y-4 pt-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="s3Endpoint">S3-Compatible Endpoint URL</Label><Input id="s3Endpoint" name="s3Endpoint" value={formData.s3Endpoint} onChange={onChange} placeholder="e.g., s3.us-west-2.amazonaws.com" required /></div>
            <div className="space-y-2"><Label htmlFor="s3BucketName">Bucket Name</Label><Input id="s3BucketName" name="s3BucketName" value={formData.s3BucketName} onChange={onChange} required /></div>
            <div className="space-y-2"><Label htmlFor="s3Region">Region</Label><Input id="s3Region" name="s3Region" value={formData.s3Region} onChange={onChange} required /></div>
            <div className="space-y-2"><Label htmlFor="s3AccessKey">Access Key</Label><Input id="s3AccessKey" name="s3AccessKey" value={formData.s3AccessKey} type="password" onChange={onChange} required /></div>
            <div className="space-y-2"><Label htmlFor="s3SecretKey">Secret Key</Label><Input id="s3SecretKey" name="s3SecretKey" type="password" value={formData.s3SecretKey} onChange={onChange} required /></div>
        </div>
    </CardContent>
);

type ScheduleStepProps = {
    formData: BackupFormData;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

const ScheduleStepContent = ({ formData, onChange }: ScheduleStepProps) => (
    <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
            <Label htmlFor="cronExpression">Cron Expression (Optional)</Label>
            <Input id="cronExpression" name="cronExpression" placeholder="e.g., 0 2 * * * (for 2 AM daily)" value={formData.cronExpression} onChange={onChange} />
            <p className="text-sm text-muted-foreground">Leave empty to run backup once immediately. Use <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer" className="text-primary underline">crontab.guru</a> to build expressions.</p>
        </div>
    </CardContent>
);

/**
 * Component to display the history of backup jobs
 */
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
                } else {
                    toast.error("Could not fetch backup history.");
                }
            } catch (error) {
                console.error("Failed to fetch backup records:", error);
                toast.error("Could not fetch backup history.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchRecords();
        const interval = setInterval(fetchRecords, 5000); // Refresh every 5 seconds
        return () => clearInterval(interval);
    }, []);

    return (
        <Card className="w-full max-w-4xl animate-in fade-in-50 duration-500">
            <CardHeader>
                <CardTitle>Backup History</CardTitle>
                <CardDescription>A list of all scheduled and completed backup jobs. Refreshes automatically.</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading && records.length === 0 ? (
                    <div className="flex flex-col justify-center items-center p-8 gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-muted-foreground">Loading history...</p>
                    </div>
                ) : records.length === 0 ? (
                    <p className="text-center text-muted-foreground p-8">No backup jobs found yet.</p>
                ) : (
                    <div className="border rounded-md">
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
                                        <TableCell className="font-medium flex items-center gap-2"><Database size={16}/> {record.dbName}</TableCell>
                                        <TableCell>
                                            <Badge variant={record.status === 'COMPLETED' ? 'default' : record.status === 'FAILED' ? 'destructive' : 'secondary'}>
                                                {(record.status === 'QUEUED' || record.status === 'PROCESSING') && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                                                {record.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>{new Date(record.createdAt).toLocaleString()}</TableCell>
                                        <TableCell className="text-xs max-w-xs truncate" title={record.fileName || record.error}>{record.fileName || record.error}</TableCell>
                                        <TableCell className="text-right">
                                            {record.status === 'COMPLETED' && record.downloadUrl && (
                                                <Button asChild variant="outline" size="sm">
                                                    <a href={record.downloadUrl} target="_blank" rel="noopener noreferrer">
                                                        <Download className="mr-2 h-4 w-4"/> Download
                                                    </a>
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

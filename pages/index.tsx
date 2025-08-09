// 📍 الملف: pages/index.tsx

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Loader2, CheckCircle, XCircle, Wand2, Moon, Sun } from "lucide-react";

type Step = 'database' | 's3' | 'schedule';
type Status = 'idle' | 'success' | 'error';

export default function HomePage() {
    const { setTheme, theme } = useTheme();
    const [formData, setFormData] = useState({
        dbType: 'postgresql',
        dbHost: 'localhost', dbPort: '5432', dbUser: 'testuser', dbPassword: 'testpassword', dbName: 'testdb',
        s3Endpoint: 'http://localhost:9000', s3BucketName: 'backups', s3AccessKey: 'minioadmin', s3SecretKey: 'minioadmin', s3Region: 'us-east-1',
        cronExpression: '',
    });
    const [currentStep, setCurrentStep] = useState<Step>('database');
    const [isLoading, setIsLoading] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<Status>('idle');

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
            if (response.ok) {
                setConnectionStatus('success');
                toast.success("Connection successful!");
            } else {
                const result = await response.json();
                setConnectionStatus('error');
                toast.error("Connection failed.", { description: result.error });
            }
        } catch (error) {
            setConnectionStatus('error');
            toast.error("Connection failed.", { description: "Check server logs." });
        }
        setIsTestingConnection(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
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
        } else {
            toast.error("Uh oh! Something went wrong.", { description: result.message });
        }
    };
    
    const renderDatabaseStep = () => (
        <CardContent className="space-y-6">
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
                <div className="space-y-2"><Label htmlFor="dbPassword">Password</Label><Input id="dbPassword" name="dbPassword" type="password" value={formData.dbPassword} onChange={handleChange} required /></div>
                <div className="space-y-2"><Label htmlFor="dbName">Database Name</Label><Input id="dbName" name="dbName" value={formData.dbName} onChange={handleChange} required /></div>
            </div>
             <div className="flex items-center justify-end space-x-2 pt-4">
                {connectionStatus === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
                {connectionStatus === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
                <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTestingConnection}>
                    {isTestingConnection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Test Connection
                </Button>
            </div>
        </CardContent>
    );

    const renderS3Step = () => (
        <CardContent className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="s3Endpoint">S3 Endpoint URL</Label><Input id="s3Endpoint" name="s3Endpoint" value={formData.s3Endpoint} onChange={handleChange} required /></div>
            <div className="space-y-2"><Label htmlFor="s3BucketName">Bucket Name</Label><Input id="s3BucketName" name="s3BucketName" value={formData.s3BucketName} onChange={handleChange} required /></div>
            <div className="space-y-2"><Label htmlFor="s3Region">Region</Label><Input id="s3Region" name="s3Region" value={formData.s3Region} onChange={handleChange} required /></div>
            <div className="space-y-2"><Label htmlFor="s3AccessKey">Access Key</Label><Input id="s3AccessKey" name="s3AccessKey" value={formData.s3AccessKey} onChange={handleChange} required /></div>
            <div className="space-y-2"><Label htmlFor="s3SecretKey">Secret Key</Label><Input id="s3SecretKey" name="s3SecretKey" type="password" value={formData.s3SecretKey} onChange={handleChange} required /></div>
        </div></CardContent>
    );
    
    const renderScheduleStep = () => (
        <CardContent className="space-y-4"><div className="space-y-2">
            <Label htmlFor="cronExpression">Cron Expression (Optional)</Label>
            <Input id="cronExpression" name="cronExpression" placeholder="e.g., 0 2 * * * (for 2 AM daily)" value={formData.cronExpression} onChange={handleChange}/>
            <p className="text-sm text-muted-foreground">Leave empty to run backup once immediately. Use <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer" className="text-primary underline">crontab.guru</a> for help.</p>
        </div></CardContent>
    );

    return (
        <main className="container mx-auto flex min-h-screen flex-col items-center justify-center p-4">
             <div className="absolute top-4 right-4">
                <Button variant="outline" size="icon" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
                    <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    <span className="sr-only">Toggle theme</span>
                </Button>
            </div>
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
        </main>
    );
}
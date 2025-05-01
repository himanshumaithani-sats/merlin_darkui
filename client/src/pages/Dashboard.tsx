import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ColumnDef,
  createColumnHelper
} from "@tanstack/react-table";
import {
  DownloadIcon,
  HelpCircleIcon,
  AlertCircleIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
  CopyIcon,
  PanelLeftIcon,
  LaptopIcon
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

// Define types
type TrackResult = {
  mawb: string;
  prefix: string;
  awbNo: string;
  status: string;
  origin: string;
  dest: string;
  pcs: string;
  grossWt: string;
  lastAct: string;
  lastActDt: string;
  doUrl: string;
};

type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled" | "paused";

type TrackJob = {
  id: number;
  filename: string;
  totalCount: number;
  processedCount: number;
  status: JobStatus;
  createdAt: string;
};

type WSMessageType = "log" | "progress" | "result" | "complete";
type LogLevel = "info" | "success" | "error" | "warn";

type WSMessage = {
  type: WSMessageType;
  jobId: number;
  message?: string;
  level?: LogLevel;
  data?: TrackResult;
  progress?: {
    current: number;
    total: number;
  };
};

const columnHelper = createColumnHelper<TrackResult>();

const columns: ColumnDef<TrackResult, any>[] = [
  columnHelper.accessor("mawb", {
    header: "MAWB",
    cell: (info) => <span className="font-mono text-xs whitespace-nowrap">{info.getValue()}</span>,
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const status = info.getValue();
      let className = "text-foreground";
      
      if (status?.includes("DELIVERED") || status?.includes("COMPLETED")) {
        className = "text-success";
      } else if (status?.includes("TRANSIT") || status?.includes("PROGRESS")) {
        className = "text-warning";
      } else if (status?.includes("HOLD") || status?.includes("DELAY")) {
        className = "text-destructive";
      }
      
      return <span className={className}>{status}</span>;
    },
  }),
  columnHelper.accessor("origin", {
    header: "Origin",
  }),
  columnHelper.accessor("dest", {
    header: "Dest",
  }),
  columnHelper.accessor("pcs", {
    header: "Pcs",
  }),
  columnHelper.accessor("grossWt", {
    header: "Weight",
  }),
  columnHelper.accessor("lastAct", {
    header: "Last Activity",
    cell: (info) => (
      <div className="max-w-[200px] truncate" title={info.getValue()}>
        {info.getValue()}
      </div>
    ),
  }),
];

export default function Dashboard() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [logs, setLogs] = useState<{ message: string; level: LogLevel }[]>([]);
  const [results, setResults] = useState<TrackResult[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [jobStatus, setJobStatus] = useState<JobStatus>("pending");
  const [requestDelay, setRequestDelay] = useState<number>(100);
  const [batchSize, setBatchSize] = useState<string>("50");
  const [useGoogleSheets, setUseGoogleSheets] = useState<boolean>(false);
  const [spreadsheetId, setSpreadsheetId] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    wsRef.current = new WebSocket(wsUrl);
    
    wsRef.current.onopen = () => {
      console.log('WebSocket connection established');
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        
        // Only process messages for the active job
        if (activeJobId !== null && message.jobId !== activeJobId) {
          return;
        }
        
        switch (message.type) {
          case "log":
            if (message.message && message.level) {
              setLogs(prev => [...prev, { message: message.message!, level: message.level! }]);
              
              // Auto-scroll to bottom of logs
              if (logsContainerRef.current) {
                setTimeout(() => {
                  if (logsContainerRef.current) {
                    logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
                  }
                }, 10);
              }
            }
            break;
          
          case "progress":
            if (message.progress) {
              setProgress(message.progress);
            }
            break;
          
          case "result":
            if (message.data) {
              setResults(prev => [...prev, message.data!]);
            }
            break;
          
          case "complete":
            if (message.message) {
              toast({
                title: "Tracking Complete",
                description: message.message,
              });
              setJobStatus("completed");
            }
            break;
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      toast({
        title: "Connection Error",
        description: "Failed to connect to real-time updates. Please refresh the page.",
        variant: "destructive",
      });
    };
    
    wsRef.current.onclose = () => {
      console.log('WebSocket connection closed');
    };
    
    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [activeJobId, toast]);

  // Handle file selection
  const handleFileSelected = (file: File) => {
    setSelectedFile(file);
    setResults([]);
    setLogs([]);
    setProgress({ current: 0, total: 0 });
    setJobStatus("pending");
    setActiveJobId(null);
    
    toast({
      title: "File Selected",
      description: `${file.name} is ready for upload.`,
    });
  };

  // Track file upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) {
        throw new Error("No file selected");
      }
      
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("delay", requestDelay.toString());
      
      const res = await fetch("/api/track/file", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to upload file");
      }
      
      return res.json();
    },
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      setJobStatus("processing");
      toast({
        title: "Processing Started",
        description: "File uploaded successfully and processing has begun.",
      });
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Job control mutation (pause, resume, cancel)
  const controlJobMutation = useMutation({
    mutationFn: async (action: "pause" | "resume" | "cancel") => {
      if (!activeJobId) {
        throw new Error("No active job");
      }
      
      const res = await apiRequest("POST", `/api/track/jobs/${activeJobId}/control`, { action });
      return res.json();
    },
    onSuccess: (data, action) => {
      setJobStatus(data.job.status);
      toast({
        title: `Job ${action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Cancelled"}`,
        description: data.message,
      });
    },
    onError: (error) => {
      toast({
        title: "Action Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Google Sheets export mutation
  const exportToGSheetsMutation = useMutation({
    mutationFn: async () => {
      if (!activeJobId) {
        throw new Error("No active job");
      }
      
      if (!spreadsheetId) {
        throw new Error("Please enter a Google Spreadsheet ID");
      }
      
      const res = await apiRequest("POST", `/api/track/results/${activeJobId}/gsheet`, { spreadsheetId });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Export Successful",
        description: data.message,
      });
    },
    onError: (error) => {
      toast({
        title: "Export Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle download Excel
  const handleDownloadExcel = () => {
    if (!activeJobId) {
      toast({
        title: "Export Failed",
        description: "No active job to export",
        variant: "destructive",
      });
      return;
    }
    
    window.open(`/api/track/results/${activeJobId}/excel`, "_blank");
  };

  // Handle copy to clipboard
  const handleCopyToClipboard = async () => {
    try {
      const text = results.map(r => `${r.mawb}, ${r.status}, ${r.origin}, ${r.dest}, ${r.pcs}, ${r.grossWt}, ${r.lastAct}`).join('\n');
      await navigator.clipboard.writeText(text);
      
      toast({
        title: "Copied to Clipboard",
        description: "Results copied to clipboard successfully.",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy results to clipboard.",
        variant: "destructive",
      });
    }
  };

  // Get job status for display
  const getStatusDisplay = () => {
    let statusColor = "bg-warning";
    let statusText = "Ready";
    
    switch (jobStatus) {
      case "processing":
        statusColor = "bg-primary animate-pulse";
        statusText = "Processing";
        break;
      case "completed":
        statusColor = "bg-success";
        statusText = "Completed";
        break;
      case "failed":
        statusColor = "bg-destructive";
        statusText = "Failed";
        break;
      case "cancelled":
        statusColor = "bg-destructive";
        statusText = "Cancelled";
        break;
      case "paused":
        statusColor = "bg-warning";
        statusText = "Paused";
        break;
    }
    
    return (
      <div className="inline-flex items-center text-sm">
        <div className={`h-2 w-2 rounded-full ${statusColor} mr-1.5`}></div>
        <span>{statusText}</span>
      </div>
    );
  };

  // Render empty state for tracking
  const renderEmptyState = () => (
    <div className="py-8 text-center">
      <AlertCircleIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium">No active tracking</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
        Upload a CSV or Excel file with AWB numbers to start tracking
      </p>
    </div>
  );

  // Render empty state for results
  const renderNoResults = () => (
    <div className="py-8 text-center">
      <p className="text-sm text-muted-foreground">No results to display yet</p>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <div className="mr-4 flex">
            <a href="#" className="flex items-center space-x-2">
              <PanelLeftIcon className="h-6 w-6 text-primary" />
              <span className="font-bold">AWB Tracker</span>
            </a>
          </div>
          <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
            <nav className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <LaptopIcon className="h-4 w-4" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1 py-6 px-4 md:px-6 container mx-auto">
        {/* Page Title */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Air Waybill Tracker</h1>
            <p className="text-muted-foreground">Upload a CSV/Excel file and track AWB numbers in real-time.</p>
          </div>
          <div className="mt-4 md:mt-0 flex space-x-2">
            <Button variant="outline" size="sm" className="h-9">
              <HelpCircleIcon className="h-4 w-4 mr-1" />
              Help
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="md:col-span-1 space-y-6">
            {/* Upload Card */}
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold mb-4">Upload File</h2>
                <FileUpload 
                  onFileSelected={handleFileSelected}
                  acceptedFileTypes=".csv,.xlsx,.xls"
                />
                {selectedFile && (
                  <>
                    <p className="text-sm mt-3 text-center">{selectedFile.name}</p>
                    {jobStatus === "pending" && (
                      <Button 
                        className="mt-4 w-full"
                        onClick={() => uploadMutation.mutate()}
                        disabled={uploadMutation.isPending}
                      >
                        {uploadMutation.isPending ? "Uploading..." : "Start Tracking"}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Configuration Card */}
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold mb-4">Configuration</h2>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="delay" className="text-sm font-medium block mb-1">
                      Request Delay (ms)
                    </Label>
                    <div className="flex items-center space-x-2">
                      <Slider
                        id="delay"
                        min={50}
                        max={1000}
                        step={50}
                        value={[requestDelay]}
                        onValueChange={(value) => setRequestDelay(value[0])}
                        disabled={jobStatus === "processing"}
                        className="flex-1"
                      />
                      <span className="text-sm font-mono bg-secondary px-2 py-1 rounded">
                        {requestDelay}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Delay between each API request
                    </p>
                  </div>
                  
                  <div>
                    <Label htmlFor="batchSize" className="text-sm font-medium block mb-1">
                      Batch Size
                    </Label>
                    <Select 
                      value={batchSize} 
                      onValueChange={setBatchSize}
                      disabled={jobStatus === "processing"}
                    >
                      <SelectTrigger id="batchSize" className="h-9">
                        <SelectValue placeholder="Select batch size" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Batch Size</SelectLabel>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Number of AWBs to track in parallel
                    </p>
                  </div>
                  
                  <div className="pt-2">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="google-sheets"
                        checked={useGoogleSheets}
                        onCheckedChange={setUseGoogleSheets}
                        disabled={jobStatus === "processing"}
                      />
                      <Label htmlFor="google-sheets" className="text-sm">
                        Save to Google Sheets
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-6">
                      Connect to Google Sheets API for direct export
                    </p>
                    
                    {useGoogleSheets && (
                      <div className="mt-2 ml-6">
                        <Label htmlFor="spreadsheetId" className="text-xs block mb-1">
                          Spreadsheet ID
                        </Label>
                        <Input
                          id="spreadsheetId"
                          value={spreadsheetId}
                          onChange={(e) => setSpreadsheetId(e.target.value)}
                          className="h-8 text-sm"
                          placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                          disabled={jobStatus === "processing"}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle & Right Columns */}
          <div className="md:col-span-2 space-y-6">
            {/* Tracking Card */}
            <Card>
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold">Tracking Progress</h2>
                  <div id="status">
                    {getStatusDisplay()}
                  </div>
                </div>

                {!activeJobId ? renderEmptyState() : (
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span>Overall Progress</span>
                        <span>{progress.current}/{progress.total}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5">
                        <div 
                          className="bg-primary h-2.5 rounded-full" 
                          style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    <div className="bg-background/40 rounded-md p-3 border border-border">
                      <h3 className="text-sm font-medium mb-2">Currently Processing</h3>
                      <div
                        ref={logsContainerRef}
                        className="font-mono text-xs bg-muted p-2 rounded min-h-[100px] max-h-[200px] overflow-y-auto"
                      >
                        {logs.map((log, index) => (
                          <div key={index} className={`log-${log.level}`}>
                            {log.message}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => controlJobMutation.mutate(jobStatus === "paused" ? "resume" : "pause")}
                        disabled={jobStatus !== "processing" && jobStatus !== "paused" || controlJobMutation.isPending}
                      >
                        {jobStatus === "paused" ? (
                          <>
                            <PlayIcon className="h-4 w-4 mr-1" />
                            Resume
                          </>
                        ) : (
                          <>
                            <PauseIcon className="h-4 w-4 mr-1" />
                            Pause
                          </>
                        )}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-9"
                        onClick={() => controlJobMutation.mutate("cancel")}
                        disabled={jobStatus !== "processing" && jobStatus !== "paused" || controlJobMutation.isPending}
                      >
                        <XIcon className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Results Card */}
            <Card>
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold">Results</h2>
                  <div className="flex space-x-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-9"
                      onClick={handleDownloadExcel}
                      disabled={!results.length || jobStatus === "pending"}
                    >
                      <DownloadIcon className="h-4 w-4 mr-1" />
                      Download Excel
                    </Button>
                    
                    {useGoogleSheets && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => exportToGSheetsMutation.mutate()}
                        disabled={!results.length || !spreadsheetId || jobStatus === "pending" || exportToGSheetsMutation.isPending}
                      >
                        Update Google Sheet
                      </Button>
                    )}
                    
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      onClick={handleCopyToClipboard}
                      disabled={!results.length}
                    >
                      <CopyIcon className="h-4 w-4" />
                      <span className="sr-only">Copy to clipboard</span>
                    </Button>
                  </div>
                </div>

                <DataTable
                  columns={columns}
                  data={results}
                  emptyState={renderNoResults()}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

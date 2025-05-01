import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { WebSocketServer } from "ws";
import { z } from "zod";
import path from "path";
import { processCSVFile, processExcelFile, trackAWB, splitMAWB, generateExcelFile, updateGoogleSheet } from "./tracking";
import { InsertTrackJob } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Setup WebSocket server for real-time updates
  // Using a different path to avoid conflicts with Vite's WebSocket
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws'
  });
  console.log("WebSocket server created");
  
  // Configure multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (_req, file, callback) => {
      const allowedExtensions = ['.csv', '.xlsx', '.xls'];
      const ext = path.extname(file.originalname).toLowerCase();
      
      if (allowedExtensions.includes(ext)) {
        callback(null, true);
      } else {
        callback(new Error('Only CSV and Excel files are allowed'));
      }
    }
  });

  // API routes
  app.post("/api/track/single", async (req, res) => {
    try {
      const body = z.object({
        mawb: z.string().min(1)
      }).parse(req.body);
      
      const { prefix, awbNo } = splitMAWB(body.mawb);
      
      if (!prefix || !awbNo) {
        return res.status(400).json({ message: "Invalid MAWB format" });
      }
      
      const result = await trackAWB(prefix, awbNo);
      
      return res.json({
        mawb: body.mawb,
        prefix,
        awbNo,
        ...result
      });
    } catch (error) {
      console.error("Error in /api/track/single:", error);
      return res.status(400).json({ message: error.message });
    }
  });
  
  // Upload and process file
  app.post("/api/track/file", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      // Validate request body
      const body = z.object({
        delay: z.coerce.number().min(50).max(1000).default(100),
      }).parse(req.body);
      
      // Get file details
      const { originalname, buffer, mimetype } = req.file;
      
      // Create a new job
      const job: InsertTrackJob = {
        filename: originalname,
        totalCount: 0, // Will be updated during processing
      };
      
      const createdJob = await storage.createTrackJob(job);
      
      // Start processing in the background
      (async () => {
        try {
          if (mimetype === 'text/csv' || originalname.endsWith('.csv')) {
            await processCSVFile(buffer, createdJob.id, body.delay, wss);
          } else {
            await processExcelFile(buffer, createdJob.id, body.delay, wss);
          }
        } catch (error) {
          console.error(`Error processing job ${createdJob.id}:`, error);
          await storage.updateTrackJobStatus(createdJob.id, 'failed');
        }
      })();
      
      return res.json({
        jobId: createdJob.id,
        message: "File processing started",
      });
    } catch (error) {
      console.error("Error in /api/track/file:", error);
      return res.status(400).json({ message: error.message });
    }
  });
  
  // Get job status
  app.get("/api/track/jobs/:id", async (req, res) => {
    try {
      const jobId = parseInt(req.params.id);
      
      if (isNaN(jobId)) {
        return res.status(400).json({ message: "Invalid job ID" });
      }
      
      const job = await storage.getTrackJob(jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      return res.json(job);
    } catch (error) {
      console.error("Error in /api/track/jobs/:id:", error);
      return res.status(500).json({ message: error.message });
    }
  });
  
  // Get all jobs
  app.get("/api/track/jobs", async (_req, res) => {
    try {
      const jobs = await storage.getTrackJobs();
      return res.json(jobs);
    } catch (error) {
      console.error("Error in /api/track/jobs:", error);
      return res.status(500).json({ message: error.message });
    }
  });
  
  // Control job (pause, resume, cancel)
  app.post("/api/track/jobs/:id/control", async (req, res) => {
    try {
      const jobId = parseInt(req.params.id);
      
      if (isNaN(jobId)) {
        return res.status(400).json({ message: "Invalid job ID" });
      }
      
      const body = z.object({
        action: z.enum(["pause", "resume", "cancel"])
      }).parse(req.body);
      
      const job = await storage.getTrackJob(jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      let newStatus;
      switch (body.action) {
        case "pause":
          newStatus = "paused";
          break;
        case "resume":
          newStatus = "processing";
          break;
        case "cancel":
          newStatus = "cancelled";
          break;
      }
      
      const updatedJob = await storage.updateTrackJobStatus(jobId, newStatus);
      
      return res.json({
        job: updatedJob,
        message: `Job ${body.action}d successfully`
      });
    } catch (error) {
      console.error("Error in /api/track/jobs/:id/control:", error);
      return res.status(400).json({ message: error.message });
    }
  });
  
  // Get results for a job
  app.get("/api/track/results/:jobId", async (req, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      
      if (isNaN(jobId)) {
        return res.status(400).json({ message: "Invalid job ID" });
      }
      
      const results = await storage.getTrackResultsByJob(jobId);
      
      return res.json(results);
    } catch (error) {
      console.error("Error in /api/track/results/:jobId:", error);
      return res.status(500).json({ message: error.message });
    }
  });
  
  // Export results to Excel
  app.get("/api/track/results/:jobId/excel", async (req, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      
      if (isNaN(jobId)) {
        return res.status(400).json({ message: "Invalid job ID" });
      }
      
      const results = await storage.getTrackResultsByJob(jobId);
      const job = await storage.getTrackJob(jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const buffer = await generateExcelFile(results);
      
      // Set response headers
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="AWB_Tracking_${job.filename}.xlsx"`);
      
      // Send the file
      return res.send(buffer);
    } catch (error) {
      console.error("Error in /api/track/results/:jobId/excel:", error);
      return res.status(500).json({ message: error.message });
    }
  });
  
  // Export to Google Sheets
  app.post("/api/track/results/:jobId/gsheet", async (req, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      
      if (isNaN(jobId)) {
        return res.status(400).json({ message: "Invalid job ID" });
      }
      
      const body = z.object({
        spreadsheetId: z.string().min(1)
      }).parse(req.body);
      
      const results = await storage.getTrackResultsByJob(jobId);
      
      const message = await updateGoogleSheet(body.spreadsheetId, results);
      
      return res.json({ message });
    } catch (error) {
      console.error("Error in /api/track/results/:jobId/gsheet:", error);
      return res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}

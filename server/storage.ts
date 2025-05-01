import {
  users,
  type User,
  type InsertUser,
  trackResults,
  type TrackResult,
  type InsertTrackResult,
  trackJobs,
  type TrackJob,
  type InsertTrackJob,
  type TrackJobStatus
} from "@shared/schema";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Track Results
  createTrackResult(result: InsertTrackResult): Promise<TrackResult>;
  getTrackResultsByJob(jobId: number): Promise<TrackResult[]>;
  
  // Track Jobs
  createTrackJob(job: InsertTrackJob): Promise<TrackJob>;
  getTrackJob(id: number): Promise<TrackJob | undefined>;
  getTrackJobs(): Promise<TrackJob[]>;
  updateTrackJobStatus(id: number, status: TrackJobStatus): Promise<TrackJob>;
  updateTrackJobProgress(id: number, processedCount: number): Promise<TrackJob>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private trackResults: Map<number, TrackResult>;
  private trackJobs: Map<number, TrackJob>;
  currentUserId: number;
  currentTrackResultId: number;
  currentTrackJobId: number;

  constructor() {
    this.users = new Map();
    this.trackResults = new Map();
    this.trackJobs = new Map();
    this.currentUserId = 1;
    this.currentTrackResultId = 1;
    this.currentTrackJobId = 1;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Track Results
  async createTrackResult(insertResult: InsertTrackResult): Promise<TrackResult> {
    const id = this.currentTrackResultId++;
    const now = new Date();
    const result: TrackResult = { 
      ...insertResult, 
      id, 
      createdAt: now
    };
    this.trackResults.set(id, result);
    return result;
  }

  async getTrackResultsByJob(jobId: number): Promise<TrackResult[]> {
    return Array.from(this.trackResults.values());
  }

  // Track Jobs
  async createTrackJob(insertJob: InsertTrackJob): Promise<TrackJob> {
    const id = this.currentTrackJobId++;
    const now = new Date();
    const job: TrackJob = { 
      ...insertJob,
      id, 
      processedCount: 0,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.trackJobs.set(id, job);
    return job;
  }

  async getTrackJob(id: number): Promise<TrackJob | undefined> {
    return this.trackJobs.get(id);
  }

  async getTrackJobs(): Promise<TrackJob[]> {
    return Array.from(this.trackJobs.values());
  }

  async updateTrackJobStatus(id: number, status: TrackJobStatus): Promise<TrackJob> {
    const job = await this.getTrackJob(id);
    if (!job) {
      throw new Error(`Track job with id ${id} not found`);
    }
    
    const updatedJob: TrackJob = {
      ...job,
      status,
      updatedAt: new Date()
    };
    
    this.trackJobs.set(id, updatedJob);
    return updatedJob;
  }

  async updateTrackJobProgress(id: number, processedCount: number): Promise<TrackJob> {
    const job = await this.getTrackJob(id);
    if (!job) {
      throw new Error(`Track job with id ${id} not found`);
    }
    
    const updatedJob: TrackJob = {
      ...job,
      processedCount,
      updatedAt: new Date()
    };
    
    this.trackJobs.set(id, updatedJob);
    return updatedJob;
  }
}

export const storage = new MemStorage();

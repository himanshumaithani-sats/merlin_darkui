import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// AWB Tracking Schema
export const trackResults = pgTable("track_results", {
  id: serial("id").primaryKey(),
  mawb: text("mawb").notNull(),
  prefix: text("prefix").notNull(),
  awbNo: text("awb_no").notNull(),
  status: text("status"),
  origin: text("origin"),
  dest: text("dest"),
  pcs: text("pcs"),
  grossWt: text("gross_wt"),
  lastAct: text("last_act"),
  lastActDt: text("last_act_dt"),
  doUrl: text("do_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTrackResultSchema = createInsertSchema(trackResults).omit({
  id: true,
  createdAt: true,
});

export type InsertTrackResult = z.infer<typeof insertTrackResultSchema>;
export type TrackResult = typeof trackResults.$inferSelect;

// Track job status
export const trackJobs = pgTable("track_jobs", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  totalCount: integer("total_count").notNull(),
  processedCount: integer("processed_count").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTrackJobSchema = createInsertSchema(trackJobs).omit({
  id: true,
  processedCount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTrackJob = z.infer<typeof insertTrackJobSchema>;
export type TrackJob = typeof trackJobs.$inferSelect;

export const trackJobStatus = z.enum(["pending", "processing", "completed", "failed", "cancelled", "paused"]);
export type TrackJobStatus = z.infer<typeof trackJobStatus>;

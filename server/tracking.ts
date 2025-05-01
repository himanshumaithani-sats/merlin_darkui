import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { Readable } from 'stream';
import { InsertTrackResult, TrackResult } from '@shared/schema';
import { storage } from './storage';
import { google } from 'googleapis';
import { WebSocketServer } from 'ws';

// Parse MAWB - splitting prefix and awbno
export function splitMAWB(mawb: string): { prefix: string, awbNo: string } {
  mawb = mawb.trim().replace(/\s/g, '');
  
  // Check if format is 123-45678901
  const parts = mawb.split('-');
  if (parts.length === 2) {
    return { prefix: parts[0], awbNo: parts[1] };
  }
  
  // Try to match pattern of 3 digits followed by 8 digits
  const regex = /(\d{3})[- ]?(\d{8})/;
  const matches = mawb.match(regex);
  
  if (matches && matches.length === 3) {
    return { prefix: matches[1], awbNo: matches[2] };
  }
  
  return { prefix: '', awbNo: '' };
}

// Track AWB by prefix and awbno
export async function trackAWB(prefix: string, awbNo: string): Promise<Partial<TrackResult>> {
  try {
    // First request to get VIEWSTATE
    const initialResponse = await fetch('https://airasia.smartkargo.com/FrmAWBTracking.aspx', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!initialResponse.ok) {
      throw new Error(`Failed to access tracking site: ${initialResponse.status} ${initialResponse.statusText}`);
    }
    
    const initialHtml = await initialResponse.text();
    const $ = cheerio.load(initialHtml);
    
    // Extract VIEWSTATE and VIEWSTATEGENERATOR values
    const viewState = $('#__VIEWSTATE').val();
    const viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();
    
    if (!viewState) {
      throw new Error('Could not extract VIEWSTATE from initial request');
    }
    
    // Build form data for tracking request
    const formData = new URLSearchParams();
    formData.append('__VIEWSTATE', viewState.toString());
    formData.append('__VIEWSTATEGENERATOR', viewStateGenerator ? viewStateGenerator.toString() : '');
    formData.append('txtPrefix', prefix);
    formData.append('TextBoxAWBno', awbNo);
    formData.append('ButtonGO', 'Track');
    formData.append('ToolkitScriptManager1_HiddenField', '');
    
    // Make tracking request
    const trackingResponse = await fetch('https://airasia.smartkargo.com/FrmAWBTracking.aspx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://airasia.smartkargo.com/FrmAWBTracking.aspx',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      body: formData.toString()
    });
    
    if (!trackingResponse.ok) {
      throw new Error(`Tracking request failed: ${trackingResponse.status} ${trackingResponse.statusText}`);
    }
    
    const trackingHtml = await trackingResponse.text();
    return parseTrackingHTML(trackingHtml);
    
  } catch (error) {
    console.error(`Error tracking AWB ${prefix}-${awbNo}:`, error);
    throw error;
  }
}

// Parse tracking HTML results
function parseTrackingHTML(html: string): Partial<TrackResult> {
  const $ = cheerio.load(html);
  
  const result: Partial<TrackResult> = {
    status: $('#lblLatestActivity').text().trim(),
    origin: $('#lblOrigin').text().trim(),
    dest: $('#lblDestination').text().trim(),
    pcs: $('#lblPcs').text().trim(),
    grossWt: $('#lblGrossWt').text().trim(),
    lastAct: $('#lblLastActivityDescription').text().trim(),
    lastActDt: $('#lblLastActivityDate').text().trim(),
    doUrl: ''
  };
  
  // Find Delivery Order PDF link
  $('#gvDeliveryOrders a').each((_idx, element) => {
    const href = $(element).attr('href');
    if (href && href.endsWith('.pdf')) {
      result.doUrl = href;
    }
  });
  
  return result;
}

// Process CSV file
export async function processCSVFile(fileBuffer: Buffer, jobId: number, delay: number = 100, wss?: WebSocketServer): Promise<number> {
  try {
    // Parse CSV
    const csvText = fileBuffer.toString('utf-8');
    const records = parse(csvText, { 
      columns: true,
      skip_empty_lines: true,
      trim: true 
    });
    
    let mawbIdx = -1;
    const headers = Object.keys(records[0]);
    
    // Find MAWB column
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].toUpperCase().includes('MAWB')) {
        mawbIdx = i;
        break;
      }
    }
    
    if (mawbIdx === -1) {
      throw new Error('MAWB column not found in CSV');
    }
    
    // Update job with total count
    const totalCount = records.length;
    await storage.updateTrackJobStatus(jobId, 'processing');
    
    // Process each record
    let processedCount = 0;
    for (const record of records) {
      // Get current row number
      processedCount++;
      
      // Get MAWB
      const mawbKey = headers[mawbIdx];
      const mawb = record[mawbKey];
      
      // Parse MAWB into prefix and awbno
      const { prefix, awbNo } = splitMAWB(mawb);
      
      if (!prefix || !awbNo) {
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Skipping invalid MAWB: ${mawb}`,
          level: 'warn'
        });
        continue;
      }
      
      try {
        // Send log message
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Tracking MAWB: ${mawb} (prefix: ${prefix}, awbno: ${awbNo})`,
          level: 'info'
        });
        
        // Track AWB
        const result = await trackAWB(prefix, awbNo);
        
        // Save result
        const trackResult: InsertTrackResult = {
          mawb,
          prefix,
          awbNo,
          status: result.status || '',
          origin: result.origin || '',
          dest: result.dest || '',
          pcs: result.pcs || '',
          grossWt: result.grossWt || '',
          lastAct: result.lastAct || '',
          lastActDt: result.lastActDt || '',
          doUrl: result.doUrl || ''
        };
        
        await storage.createTrackResult(trackResult);
        
        // Send success message
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Success: ${mawb}`,
          level: 'success'
        });
        
        // Send result to client
        broadcastMessage(wss, jobId, {
          type: 'result',
          data: trackResult
        });
        
      } catch (error) {
        console.error(`Error processing row ${processedCount}:`, error);
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Error tracking ${mawb}: ${error}`,
          level: 'error'
        });
      }
      
      // Update job progress
      await storage.updateTrackJobProgress(jobId, processedCount);
      broadcastMessage(wss, jobId, {
        type: 'progress',
        progress: {
          current: processedCount,
          total: totalCount
        }
      });
      
      // Be polite to server - add delay
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Mark job as completed
    await storage.updateTrackJobStatus(jobId, 'completed');
    broadcastMessage(wss, jobId, {
      type: 'complete',
      message: `Tracking completed. Processed ${processedCount} records.`
    });
    
    return processedCount;
  } catch (error) {
    console.error('Error processing CSV:', error);
    await storage.updateTrackJobStatus(jobId, 'failed');
    throw error;
  }
}

// Process Excel file
export async function processExcelFile(fileBuffer: Buffer, jobId: number, delay: number = 100, wss?: WebSocketServer): Promise<number> {
  try {
    // Parse Excel
    const workbook = XLSX.read(fileBuffer);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const records = XLSX.utils.sheet_to_json(worksheet);
    
    // Find MAWB column
    let mawbKey = '';
    if (records.length > 0) {
      const firstRow = records[0] as Record<string, any>;
      for (const key of Object.keys(firstRow)) {
        if (key.toUpperCase().includes('MAWB')) {
          mawbKey = key;
          break;
        }
      }
    }
    
    if (!mawbKey) {
      throw new Error('MAWB column not found in Excel');
    }
    
    // Update job with total count
    const totalCount = records.length;
    await storage.updateTrackJobStatus(jobId, 'processing');
    
    // Process each record
    let processedCount = 0;
    for (const record of records) {
      // Get current row number
      processedCount++;
      
      // Get MAWB
      const typedRecord = record as Record<string, any>;
      const mawb = typedRecord[mawbKey]?.toString() || '';
      
      // Parse MAWB into prefix and awbno
      const { prefix, awbNo } = splitMAWB(mawb);
      
      if (!prefix || !awbNo) {
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Skipping invalid MAWB: ${mawb}`,
          level: 'warn'
        });
        continue;
      }
      
      try {
        // Send log message
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Tracking MAWB: ${mawb} (prefix: ${prefix}, awbno: ${awbNo})`,
          level: 'info'
        });
        
        // Track AWB
        const result = await trackAWB(prefix, awbNo);
        
        // Save result
        const trackResult: InsertTrackResult = {
          mawb,
          prefix,
          awbNo,
          status: result.status || '',
          origin: result.origin || '',
          dest: result.dest || '',
          pcs: result.pcs || '',
          grossWt: result.grossWt || '',
          lastAct: result.lastAct || '',
          lastActDt: result.lastActDt || '',
          doUrl: result.doUrl || ''
        };
        
        await storage.createTrackResult(trackResult);
        
        // Send success message
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Success: ${mawb}`,
          level: 'success'
        });
        
        // Send result to client
        broadcastMessage(wss, jobId, {
          type: 'result',
          data: trackResult
        });
        
      } catch (error) {
        console.error(`Error processing row ${processedCount}:`, error);
        broadcastMessage(wss, jobId, {
          type: 'log',
          message: `[Row ${processedCount}] Error tracking ${mawb}: ${error}`,
          level: 'error'
        });
      }
      
      // Update job progress
      await storage.updateTrackJobProgress(jobId, processedCount);
      broadcastMessage(wss, jobId, {
        type: 'progress',
        progress: {
          current: processedCount,
          total: totalCount
        }
      });
      
      // Be polite to server - add delay
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Mark job as completed
    await storage.updateTrackJobStatus(jobId, 'completed');
    broadcastMessage(wss, jobId, {
      type: 'complete',
      message: `Tracking completed. Processed ${processedCount} records.`
    });
    
    return processedCount;
  } catch (error) {
    console.error('Error processing Excel:', error);
    await storage.updateTrackJobStatus(jobId, 'failed');
    throw error;
  }
}

// Generate Excel file from results
export async function generateExcelFile(results: TrackResult[]): Promise<Buffer> {
  // Create workbook & sheet
  const workbook = XLSX.utils.book_new();
  const headers = ['MAWB', 'Prefix', 'AWBNo', 'Status', 'Origin', 'Dest', 'Pcs', 'GrossWt', 'LastAct', 'DOUrl'];
  
  // Convert results to rows
  const rows = results.map(r => [
    r.mawb,
    r.prefix,
    r.awbNo,
    r.status,
    r.origin,
    r.dest,
    r.pcs,
    r.grossWt,
    r.lastAct,
    r.doUrl
  ]);
  
  // Add headers as first row
  rows.unshift(headers);
  
  // Create worksheet and add to workbook
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  
  // Generate buffer
  const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return excelBuffer;
}

// Update Google Sheets
export async function updateGoogleSheet(spreadsheetId: string, results: TrackResult[]): Promise<string> {
  try {
    // Setup auth with service account credentials
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Prepare header row
    const headerValues = [['MAWB', 'Prefix', 'AWBNo', 'Status', 'Origin', 'Dest', 'Pcs', 'GrossWt', 'LastAct', 'DOUrl']];
    
    // Prepare data rows
    const dataValues = results.map(r => [
      r.mawb,
      r.prefix,
      r.awbNo,
      r.status,
      r.origin,
      r.dest,
      r.pcs,
      r.grossWt,
      r.lastAct,
      r.doUrl
    ]);
    
    // Clear existing content
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Sheet1!A1:J1000', // Adjust range as needed
    });
    
    // Write header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Sheet1!A1:J1',
      valueInputOption: 'RAW',
      requestBody: {
        values: headerValues,
      },
    });
    
    // Write data
    if (dataValues.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!A2:J${dataValues.length + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: dataValues,
        },
      });
    }
    
    return `Successfully updated Google Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  } catch (error) {
    console.error('Error updating Google Sheet:', error);
    throw error;
  }
}

// WebSocket broadcast helper
function broadcastMessage(wss: WebSocketServer | undefined, jobId: number, message: any) {
  if (!wss) return;
  
  const messageWithJobId = {
    ...message,
    jobId
  };
  
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(messageWithJobId));
    }
  });
}

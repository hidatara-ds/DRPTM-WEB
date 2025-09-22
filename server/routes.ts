import type { Express } from "express";
import { storage } from "./storage";
import {
  insertSensorReadingSchema,
  insertAlertSettingsSchema,
  sensorReadingSchema,
} from "@shared/schema";


export async function registerRoutes(app: Express): Promise<void> {
  // Health check endpoint for debugging
  app.get("/api/health", async (req, res) => {
    try {
      const systemStatus = await storage.getSystemStatus();
      const readings = await storage.getSensorReadings(1);
      
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        databaseAvailable: !!process.env.DATABASE_URL,
        externalApiConfigured: !!(process.env.EXTERNAL_DB_API_URL && process.env.EXTERNAL_DB_API_KEY),
        systemStatus: systemStatus,
        hasReadings: readings.length > 0,
        readingsCount: readings.length,
        latestReading: readings[0] || null
      });
    } catch (error) {
      console.error("Health check error:", error);
      res.status(500).json({ 
        error: "Health check failed",
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      });
    }
  });

  // Debug endpoint to test data directly
  app.get("/api/debug", async (req, res) => {
    try {
      console.log("🔍 Debug endpoint called");
      const readings = await storage.getSensorReadings(5);
      console.log("🔍 Debug - readings count:", readings.length);
      console.log("🔍 Debug - readings:", readings);
      
      res.json({
        message: "Debug data",
        timestamp: new Date().toISOString(),
        readingsCount: readings.length,
        readings: readings,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          DATABASE_URL: !!process.env.DATABASE_URL,
          EXTERNAL_DB_API_URL: !!process.env.EXTERNAL_DB_API_URL,
          EXTERNAL_DB_API_KEY: !!process.env.EXTERNAL_DB_API_KEY
        }
      });
    } catch (error) {
      console.error("Debug endpoint error:", error);
      res.status(500).json({ 
        error: "Debug failed",
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      });
    }
  });

  // Get recent sensor readings
  app.get("/api/sensor-readings", async (req, res) => {
    try {
      console.log("Fetching sensor readings...");
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const readings = await storage.getSensorReadings(limit);
      console.log(`Retrieved ${readings.length} sensor readings`);
      res.json(readings);
    } catch (error) {
      console.error("Error fetching sensor readings:", error);
      res.status(500).json({ 
        error: "Failed to fetch sensor readings",
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      });
    }
  });

  // Get sensor readings by time range
  app.get("/api/sensor-readings/range", async (req, res) => {
    try {
      const { startTime, endTime } = req.query;

      if (!startTime || !endTime) {
        return res
          .status(400)
          .json({ error: "startTime and endTime are required" });
      }

      const readings = await storage.getSensorReadingsByTimeRange(
        startTime as string,
        endTime as string
      );
      res.json(readings);
    } catch (error) {
      console.error("Error fetching sensor readings by range:", error);
      res.status(500).json({ error: "Failed to fetch sensor readings" });
    }
  });

  // Get latest sensor reading
  app.get("/api/sensor-readings/latest", async (req, res) => {
    try {
      const readings = await storage.getSensorReadings(1);
      const latest = readings[0] || null;
      res.json(latest);
    } catch (error) {
      console.error("Error fetching latest sensor reading:", error);
      res.status(500).json({ error: "Failed to fetch latest sensor reading" });
    }
  });

  // Create new sensor reading (for manual data entry or testing)
  app.post("/api/sensor-readings", async (req, res) => {
    try {
      const validatedData = insertSensorReadingSchema.parse(req.body);
      const reading = await storage.createSensorReading(validatedData);
      res.status(201).json(reading);
    } catch (error) {
      console.error("Error creating sensor reading:", error);
      res.status(400).json({ error: "Invalid sensor reading data" });
    }
  });

  // Manual sync endpoint to force data fetch from Antares
  app.post("/api/sync-antares", async (req, res) => {
    try {
      console.log("Manual sync requested from frontend");
      // Force fetch fresh data by calling getSensorReadings which will trigger external fetch
      const readings = await storage.getSensorReadings(1);
      const status = await storage.getSystemStatus();
      
      res.json({
        success: true,
        message: "Data sync completed",
        latestReading: readings[0] || null,
        connectionStatus: status.connectionStatus
      });
    } catch (error) {
      console.error("Error during manual sync:", error);
      res.status(500).json({ 
        success: false,
        error: "Failed to sync data from Antares IoT platform" 
      });
    }
  });

  

  // Get system status
  app.get("/api/system-status", async (req, res) => {
    try {
      const status = await storage.getSystemStatus();
      res.json(status);
    } catch (error) {
      console.error("Error fetching system status:", error);
      res.status(500).json({ error: "Failed to fetch system status" });
    }
  });

  // Get alert settings
  app.get("/api/alert-settings", async (req, res) => {
    try {
      const settings = await storage.getAlertSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching alert settings:", error);
      res.status(500).json({ error: "Failed to fetch alert settings" });
    }
  });

  // Update alert settings
  app.put("/api/alert-settings", async (req, res) => {
    try {
      const validatedSettings = insertAlertSettingsSchema.parse(req.body);
      const settings = await storage.updateAlertSettings(validatedSettings);
      res.json(settings);
    } catch (error) {
      console.error("Error updating alert settings:", error);
      res.status(400).json({ error: "Invalid alert settings data" });
    }
  });

  // Export sensor data
  app.get("/api/export-data", async (req, res) => {
    try {
      const { format = "json", startTime, endTime } = req.query;

      let readings;
      if (startTime && endTime) {
        readings = await storage.getSensorReadingsByTimeRange(
          startTime as string,
          endTime as string
        );
      } else {
        readings = await storage.getSensorReadings(1000); // Export last 1000 readings
      }

      if (format === "csv") {
        const csvHeaders = "timestamp,temperature,ph,tdsLevel\n";
        const csvData = readings
          .map((r) => `${r.timestamp},${r.temperature},${r.ph},${r.tdsLevel}`)
          .join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=sensor-data.csv"
        );
        res.send(csvHeaders + csvData);
      } else {
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=sensor-data.json"
        );
        res.json(readings);
      }
    } catch (error) {
      console.error("Error exporting data:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  // Note: HTTP server and periodic tasks are handled by the main server
  // In Vercel functions, we only register the routes
}

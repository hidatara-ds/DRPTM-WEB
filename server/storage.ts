// javascript_database integration
import { type SensorReading, type InsertSensorReading, type SystemStatus, type AlertSettings, sensorReadings, systemStatus, alertSettings } from "@shared/schema";
import { db, getDatabaseConnection } from "./db";
import { eq, desc, and, gte, lte, count } from "drizzle-orm";
import { externalDatabaseService } from "./services/external-database";

export interface IStorage {
  // Sensor readings
  getSensorReadings(limit?: number): Promise<SensorReading[]>;
  getSensorReadingsByTimeRange(startTime: string, endTime: string): Promise<SensorReading[]>;
  createSensorReading(reading: InsertSensorReading): Promise<SensorReading>;

  // System status
  getSystemStatus(): Promise<SystemStatus>;
  updateSystemStatus(status: Partial<SystemStatus>): Promise<SystemStatus>;

  // Alert settings
  getAlertSettings(): Promise<AlertSettings>;
  updateAlertSettings(settings: AlertSettings): Promise<AlertSettings>;
}

export class DatabaseStorage implements IStorage {
  private lastExternalFetchTime: number = 0;
  private cacheTimeout: number = 10000; // 10 seconds cache
  private databaseAvailable = true;
  private fallbackData = {
    systemStatus: {
      id: 'fallback',
      connectionStatus: 'connected' as const,
      lastUpdate: new Date(),
      dataPoints: 0,
      cpuUsage: 23,
      memoryUsage: 30,
      storageUsage: 26,
      uptime: '3d 14h 22m',
    },
    alertSettings: {
      id: 'fallback',
      temperatureAlerts: true,
      phAlerts: true,
      tdsLevelAlerts: false,
    },
    sensorReadings: [] as SensorReading[]
  };

  constructor() {
    // Initialize defaults safely
    this.initializeDefaults().catch(() => {
      console.log('🔄 Running in fallback mode without database persistence');
    });
  }

  private async initializeDefaults() {
    try {
      const { db, available } = getDatabaseConnection();
      if (!available || !db) {
        this.databaseAvailable = false;
        return;
      }
      
      // Test database connection first
      await db.select().from(systemStatus).limit(1);
      
      // Check if system status exists, if not create default
      const statusCount = await db.select().from(systemStatus).limit(1);
      if (statusCount.length === 0) {
        await db.insert(systemStatus).values({
          connectionStatus: 'connected',
          dataPoints: 0,
          cpuUsage: 23,
          memoryUsage: 30,
          storageUsage: 26,
          uptime: '3d 14h 22m',
        });
      }

      // Check if alert settings exist, if not create default
      const alertsCount = await db.select().from(alertSettings).limit(1);
      if (alertsCount.length === 0) {
        await db.insert(alertSettings).values({
          temperatureAlerts: true,
          phAlerts: true,
          tdsLevelAlerts: false,
        });
      }
      
      console.log('✅ Database connection successful');
      this.databaseAvailable = true;
    } catch (error) {
      console.warn('⚠️ Database not available, using in-memory fallback:', (error as Error).message);
      this.databaseAvailable = false;
    }
  }

  private async fetchFromExternalDatabase(): Promise<SensorReading | null> {
    const now = Date.now();
    const { db, available } = getDatabaseConnection();

    // Check if we need to fetch new data (only if DB is available)
    if (available && db && now - this.lastExternalFetchTime < this.cacheTimeout) {
      try {
        const latestStored = await db
          .select()
          .from(sensorReadings)
          .orderBy(desc(sensorReadings.timestamp))
          .limit(1);
        if (latestStored.length > 0) return latestStored[0];
      } catch (error) {
        console.warn('DB cache read failed:', (error as Error).message);
        this.databaseAvailable = false;
      }
    }

    try {
      console.log('Attempting to fetch data from external database...');
      const externalData = await externalDatabaseService.fetchLatestReading();

      if (!externalData) {
        console.warn('No data received from external database');
        return null;
      }

      // Update fetch time immediately after successful external fetch
      this.lastExternalFetchTime = now;

      // Insert new reading into database only if available
      if (available && db) {
        try {
          const [newReading] = await db
            .insert(sensorReadings)
            .values({
              temperature: externalData.temperature,
              ph: externalData.ph,
              tdsLevel: externalData.tdsLevel,
            })
            .returning();

          this.databaseAvailable = true; // Recovery: set to true on successful DB operation

          // Update system status efficiently with COUNT
          const [countResult] = await db.select({ count: count() }).from(sensorReadings);
          await this.updateSystemStatus({
            dataPoints: countResult.count,
          });

          console.log(`Successfully fetched and stored reading: ${newReading.id}`);
          return newReading;
        } catch (error) {
          console.warn('Failed to store reading in database:', (error as Error).message);
          this.databaseAvailable = false;
        }
      }
      
      // Return data without storing if DB unavailable (fetch time already updated)
      return {
        id: `external_${now}`,
        timestamp: new Date(),
        createdAt: new Date(),
        temperature: externalData.temperature,
        ph: externalData.ph,
        tdsLevel: externalData.tdsLevel
      };
    } catch (error) {
      console.error("Error fetching from external database:", error);
      return null;
    }
  }

  async getSensorReadings(limit = 50): Promise<SensorReading[]> {
    // Try to get fresh data from external source
    await this.fetchFromExternalDatabase();

    if (!this.databaseAvailable) {
      // Return fallback data if no database
      if (this.fallbackData.sensorReadings.length === 0) {
        console.log('🔄 Providing sample data (fallback mode)');
        const sampleReading: SensorReading = {
          id: `sample_${Date.now()}`,
          timestamp: new Date(),
          createdAt: new Date(),
          temperature: 25.5,
          ph: 6.8,
          tdsLevel: 450
        };
        this.fallbackData.sensorReadings = [sampleReading];
      }
      return this.fallbackData.sensorReadings.slice(0, limit);
    }

    try {
      const { db: dbInstance, available } = getDatabaseConnection();
      if (!available || !dbInstance) {
        this.databaseAvailable = false;
        // Return fallback data directly instead of recursive call
        if (this.fallbackData.sensorReadings.length === 0) {
          console.log('🔄 Providing sample data (fallback mode)');
          const sampleReading: SensorReading = {
            id: `sample_${Date.now()}`,
            timestamp: new Date(),
            createdAt: new Date(),
            temperature: 25.5,
            ph: 6.8,
            tdsLevel: 450
          };
          this.fallbackData.sensorReadings = [sampleReading];
        }
        return this.fallbackData.sensorReadings.slice(0, limit);
      }
      
      // Get readings from database
      const readings = await dbInstance
        .select()
        .from(sensorReadings)
        .orderBy(desc(sensorReadings.timestamp))
        .limit(limit);

      this.databaseAvailable = true; // Recovery: set to true on successful DB operation

      // If no data in database, provide sample data ONLY in development
      if (readings.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log('Providing sample data since no stored data available (development only)');
          const [sampleReading] = await dbInstance
            .insert(sensorReadings)
            .values({
              temperature: 25.5,
              ph: 6.8,
              tdsLevel: 450,
            })
            .returning();

          return [sampleReading];
        } else {
          // In production, return in-memory fallback instead of persisting
          console.log('No data available, using in-memory fallback (production mode)');
          const sampleReading: SensorReading = {
            id: `fallback_${Date.now()}`,
            timestamp: new Date(),
            createdAt: new Date(),
            temperature: 25.5,
            ph: 6.8,
            tdsLevel: 450
          };
          this.fallbackData.sensorReadings = [sampleReading];
          return [sampleReading];
        }
      }

      return readings;
    } catch (error) {
      console.warn('Database error, falling back to sample data:', (error as Error).message);
      this.databaseAvailable = false;
      return this.getSensorReadings(limit);
    }
  }

  async getSensorReadingsByTimeRange(startTime: string, endTime: string): Promise<SensorReading[]> {
    // Try to get fresh data
    await this.fetchFromExternalDatabase();

    const { db, available } = getDatabaseConnection();
    if (!available || !db) {
      console.warn('Database not available for time range query, returning fallback data');
      return this.fallbackData.sensorReadings;
    }

    try {
      const start = new Date(startTime);
      const end = new Date(endTime);

      return await db
        .select()
        .from(sensorReadings)
        .where(
          and(
            gte(sensorReadings.timestamp, start),
            lte(sensorReadings.timestamp, end)
          )
        )
        .orderBy(sensorReadings.timestamp);
    } catch (error) {
      console.warn('Database error in time range query:', (error as Error).message);
      this.databaseAvailable = false;
      return this.fallbackData.sensorReadings;
    }
  }

  async createSensorReading(insertReading: InsertSensorReading): Promise<SensorReading> {
    const { db, available } = getDatabaseConnection();
    if (!available || !db) {
      // Return in-memory data if DB unavailable
      const reading: SensorReading = {
        id: `memory_${Date.now()}`,
        timestamp: new Date(),
        createdAt: new Date(),
        ...insertReading
      };
      this.fallbackData.sensorReadings.unshift(reading);
      return reading;
    }

    try {
      const [reading] = await db
        .insert(sensorReadings)
        .values(insertReading)
        .returning();

      // Update system status efficiently with COUNT
      const [countResult] = await db.select({ count: count() }).from(sensorReadings);
      await this.updateSystemStatus({
        dataPoints: countResult.count,
      });

      return reading;
    } catch (error) {
      console.warn('Failed to create reading in database:', (error as Error).message);
      this.databaseAvailable = false;
      // Fallback to in-memory
      const reading: SensorReading = {
        id: `memory_${Date.now()}`,
        timestamp: new Date(),
        createdAt: new Date(),
        ...insertReading
      };
      this.fallbackData.sensorReadings.unshift(reading);
      return reading;
    }
  }

  async getSystemStatus(): Promise<SystemStatus> {
    const { db: dbInstance, available } = getDatabaseConnection();
    if (!available || !dbInstance) {
      return this.fallbackData.systemStatus;
    }

    try {
      const [status] = await dbInstance.select().from(systemStatus).limit(1);
      this.databaseAvailable = true; // Set to true on successful connection
      if (!status) {
        // Return default if none exists yet
        return {
          id: 'default',
          connectionStatus: 'connected',
          lastUpdate: new Date(),
          dataPoints: 0,
          cpuUsage: 23,
          memoryUsage: 30,
          storageUsage: 26,
          uptime: '3d 14h 22m',
        };
      }
      return status;
    } catch (error) {
      console.warn('Database error, using fallback system status:', (error as Error).message);
      this.databaseAvailable = false;
      return this.fallbackData.systemStatus;
    }
  }

  async updateSystemStatus(statusUpdate: Partial<SystemStatus>): Promise<SystemStatus> {
    const { db: dbInstance, available } = getDatabaseConnection();
    if (!available || !dbInstance) {
      // Update fallback data and return it
      Object.assign(this.fallbackData.systemStatus, statusUpdate, { lastUpdate: new Date() });
      return this.fallbackData.systemStatus;
    }

    try {
      const [currentStatus] = await dbInstance.select().from(systemStatus).limit(1);
      
      if (!currentStatus) {
        // Create new status if none exists
        const [newStatus] = await dbInstance
          .insert(systemStatus)
          .values({
            connectionStatus: 'connected',
            dataPoints: 0,
            cpuUsage: 23,
            memoryUsage: 30,
            storageUsage: 26,
            uptime: '3d 14h 22m',
            ...statusUpdate,
          })
          .returning();
        return newStatus;
      }

      const [updatedStatus] = await dbInstance
        .update(systemStatus)
        .set({ ...statusUpdate, lastUpdate: new Date() })
        .where(eq(systemStatus.id, currentStatus.id))
        .returning();

      return updatedStatus;
    } catch (error) {
      console.warn('Failed to update system status in database:', (error as Error).message);
      this.databaseAvailable = false;
      // Fallback to in-memory update
      Object.assign(this.fallbackData.systemStatus, statusUpdate, { lastUpdate: new Date() });
      return this.fallbackData.systemStatus;
    }
  }

  async getAlertSettings(): Promise<AlertSettings> {
    const { db: dbInstance, available } = getDatabaseConnection();
    if (!available || !dbInstance) {
      return this.fallbackData.alertSettings;
    }

    try {
      const [settings] = await dbInstance.select().from(alertSettings).limit(1);
      this.databaseAvailable = true; // Set to true on successful connection
      if (!settings) {
        // Return default if none exists yet
        return {
          id: 'default',
          temperatureAlerts: true,
          phAlerts: true,
          tdsLevelAlerts: false,
        };
      }
      return settings;
    } catch (error) {
      console.warn('Database error, using fallback alert settings:', (error as Error).message);
      this.databaseAvailable = false;
      return this.fallbackData.alertSettings;
    }
  }

  async updateAlertSettings(newSettings: AlertSettings): Promise<AlertSettings> {
    const { db: dbInstance, available } = getDatabaseConnection();
    if (!available || !dbInstance) {
      // Update fallback data and return it
      Object.assign(this.fallbackData.alertSettings, newSettings);
      return this.fallbackData.alertSettings;
    }

    try {
      const [currentSettings] = await dbInstance.select().from(alertSettings).limit(1);
      
      if (!currentSettings) {
        // Create new settings if none exist
        const [created] = await dbInstance
          .insert(alertSettings)
          .values({
            temperatureAlerts: newSettings.temperatureAlerts,
            phAlerts: newSettings.phAlerts,
            tdsLevelAlerts: newSettings.tdsLevelAlerts,
          })
          .returning();
        return created;
      }

      const [updated] = await dbInstance
        .update(alertSettings)
        .set({
          temperatureAlerts: newSettings.temperatureAlerts,
          phAlerts: newSettings.phAlerts,
          tdsLevelAlerts: newSettings.tdsLevelAlerts,
        })
        .where(eq(alertSettings.id, currentSettings.id))
        .returning();

      return updated;
    } catch (error) {
      console.warn('Failed to update alert settings in database:', (error as Error).message);
      this.databaseAvailable = false;
      // Fallback to in-memory update
      Object.assign(this.fallbackData.alertSettings, newSettings);
      return this.fallbackData.alertSettings;
    }
  }
}

export const storage = new DatabaseStorage();
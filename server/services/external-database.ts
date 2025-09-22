export interface ExternalDatabaseReading {
  id: string;
  temperature: number;
  ph: number;
  tdsLevel: number;
  timestamp: string;
}

export class ExternalDatabaseService {
  private apiUrl: string;
  private apiKey: string;
  private cfAccessClientId?: string;
  private cfAccessClientSecret?: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID;
    this.cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  }

  // Decode HEX data based on device code
  private decodeHexData(hexString: string, deviceCode: string) {
    try {
      console.log(`Decoding hex data: ${hexString} for device: ${deviceCode}`);

      if (deviceCode.startsWith("CZ")) {
        // Cabai (4 sensors)
        return {
          ph: parseInt(hexString.substr(0, 4), 16) / 100,
          moisture: parseInt(hexString.substr(4, 4), 16) / 10,
          ec: parseInt(hexString.substr(8, 4), 16) / 100,
          temperature: parseInt(hexString.substr(12, 4), 16) / 10,
        };
      }

      if (deviceCode.startsWith("MZ") || deviceCode.startsWith("SZ")) {
        // Melon/Selada (3 sensors)
        return {
          ph: parseInt(hexString.substr(0, 4), 16) / 100,
          ec: parseInt(hexString.substr(4, 4), 16) / 100,
          temperature: parseInt(hexString.substr(8, 4), 16) / 10,
        };
      }

      if (deviceCode.startsWith("GZ")) {
        // Greenhouse (3 sensors)
        return {
          temperature: parseInt(hexString.substr(0, 4), 16) / 10,
          humidity: parseInt(hexString.substr(4, 4), 16) / 10,
          light: parseInt(hexString.substr(8, 4), 16),
        };
      }

      if (deviceCode.startsWith("HZ")) {
        // Hydroponic (3 sensors - pH, TDS/EC, Temperature)
        return {
          ph: parseInt(hexString.substr(0, 4), 16) / 100,
          tdsLevel: parseInt(hexString.substr(4, 4), 16) / 10, // TDS level
          temperature: parseInt(hexString.substr(8, 4), 16) / 10,
        };
      }

      console.warn(
        `Unknown device code: ${deviceCode}, cannot decode hex data`
      );
      return null;
    } catch (error) {
      console.error("Error decoding hex data:", error);
      return null;
    }
  }

  async fetchLatestReading(): Promise<ExternalDatabaseReading | null> {
    try {
      console.log(`Fetching data from: ${this.apiUrl}`);
      // Implement timeout using AbortController with longer timeout and basic retry
      const attemptFetch = async (attempt: number) => {
        const controller = new AbortController();
        const timeoutMs = 10000; // 10s per attempt
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const headers: Record<string, string> = {
            "X-API-KEY": this.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "HydroMonitor/1.0",
          };
          if (this.cfAccessClientId && this.cfAccessClientSecret) {
            headers["CF-Access-Client-Id"] = this.cfAccessClientId;
            headers["CF-Access-Client-Secret"] = this.cfAccessClientSecret;
          }

          const res = await fetch(this.apiUrl, {
            method: "GET",
            headers,
            redirect: "follow",
            signal: controller.signal,
          });
          return res;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            console.error(`Request timeout after ${timeoutMs}ms on attempt ${attempt}`);
          }
          throw err;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      let response: any = null;
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          response = await attemptFetch(attempt);
          break;
        } catch (e) {
          if (attempt === maxAttempts) throw e;
          await new Promise(r => setTimeout(r, 300 * attempt));
        }
      }

      if (!response) {
        throw new Error("No response received from external database");
      }

      console.log(`Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        // Log more details about the error
        const errorText = await response.text();
        console.error(`API Error Details: ${errorText}`);
        throw new Error(
          `External database API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Expected JSON response but got ${contentType}`);
      }

      const data = await response.json();
      console.log("Received data:", data);

      // Extract device code and encoded data
      const deviceCode = data.device_code || "UNKNOWN";
      const encodedData = data.reading?.encoded_data;

      if (!encodedData) {
        console.error("No encoded_data found in response:", data);
        return null;
      }

      // Decode the hex data
      const decodedData = this.decodeHexData(encodedData, deviceCode);

      if (!decodedData) {
        console.error("Failed to decode hex data for device:", deviceCode);
        return null;
      }

      console.log("Decoded sensor data:", decodedData);

      // Adapt decoded data to our schema
      const adaptedData = {
        id: data.id || data._id || data.reading_id || `ext_${Date.now()}`,
        temperature: decodedData.temperature || 0,
        ph: decodedData.ph || 0,
        tdsLevel: decodedData.tdsLevel || decodedData.ec || 0, // Use TDS or EC as fallback
        timestamp:
          data.reading?.timestamp ||
          data.timestamp ||
          data.created_at ||
          data.time ||
          new Date().toISOString(),
      };

      console.log("Final adapted data:", adaptedData);

      return adaptedData;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error("Request timeout: External database API did not respond within 5 seconds");
      } else {
        console.error("Error fetching data from external database:", error);
      }
      return null;
    }
  }
}

export const externalDatabaseService = new ExternalDatabaseService(
  process.env.EXTERNAL_DB_API_URL ||
    "https://web-production-e195b.up.railway.app/api/latest-readings/HZ1",
  process.env.EXTERNAL_DB_API_KEY || "ithinkyouthinktoomuchofme"
);

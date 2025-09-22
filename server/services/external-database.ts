// externalDatabase.service.ts

export interface ExternalDatabaseReading {
  id: string;
  temperature: number;
  ph: number;
  tdsLevel: number;
  timestamp: string;
}

type FetchAttemptOptions = {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

export class ExternalDatabaseService {
  private apiUrl: string;
  private apiKey: string;
  private cfAccessClientId?: string;
  private cfAccessClientSecret?: string;
  private allowQueryKeyFallback: boolean;
  private timeoutMs: number;
  private maxAttempts: number;

  /**
   * @param baseUrl bisa langsung full URL endpoint
   *   (contoh: https://app.up.railway.app/api/latest-readings/HZ1)
   *   atau cukup origin (contoh: https://app.up.railway.app) + deviceCode di env.
   * @param apiKey API key yang sama dengan API_KEY di service Railway (server).
   */
  constructor(baseUrl: string, apiKey: string) {
    // ---- Compose URL yang benar ----
    const trimmed = (baseUrl || "").trim();
    const deviceFromEnv =
      process.env.EXTERNAL_DB_DEVICE ||
      process.env.DEVICE_CODE ||
      "HZ1"; // default aman

    // Jika baseUrl sudah langsung endpoint -> pakai apa adanya.
    // Kalau baseUrl hanya origin, build ke /api/latest-readings/:device
    if (/\/api\/latest-readings\//i.test(trimmed)) {
      this.apiUrl = trimmed.replace(/\/+$/, "");
    } else {
      const origin = trimmed.replace(/\/+$/, "");
      this.apiUrl = `${origin}/api/latest-readings/${deviceFromEnv}`;
    }

    this.apiKey = apiKey;

    // Optional (Cloudflare Access)
    this.cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID;
    this.cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

    // Konfigurasi umum
    this.allowQueryKeyFallback =
      (process.env.ALLOW_QUERY_KEY_FALLBACK || "true").toLowerCase() === "true";
    this.timeoutMs = Number(process.env.EXT_API_TIMEOUT_MS || 10000); // 10s
    this.maxAttempts = Number(process.env.EXT_API_MAX_ATTEMPTS || 2); // 2x
  }

  // ----- Decoder HEX per jenis device -----
  private decodeHexData(hexString: string, deviceCode: string) {
    try {
      const hex = (hexString || "").toLowerCase();
      if (!hex || hex.length < 6) return null;

      if (deviceCode.startsWith("CZ")) {
        // Cabai (4 sensors)
        return {
          ph: parseInt(hex.substring(0, 4), 16) / 100,
          moisture: parseInt(hex.substring(4, 8), 16) / 10,
          ec: parseInt(hex.substring(8, 12), 16) / 100,
          temperature: parseInt(hex.substring(12, 16), 16) / 10,
        };
      }

      if (deviceCode.startsWith("MZ") || deviceCode.startsWith("SZ")) {
        // Melon/Selada (3 sensors)
        return {
          ph: parseInt(hex.substring(0, 4), 16) / 100,
          ec: parseInt(hex.substring(4, 8), 16) / 100,
          temperature: parseInt(hex.substring(8, 12), 16) / 10,
        };
      }

      if (deviceCode.startsWith("GZ")) {
        // Greenhouse (3 sensors)
        return {
          temperature: parseInt(hex.substring(0, 4), 16) / 10,
          humidity: parseInt(hex.substring(4, 8), 16) / 10,
          light: parseInt(hex.substring(8, 12), 16),
        };
      }

      if (deviceCode.startsWith("HZ")) {
        // Hydroponic (pH, TDS/EC, Temperature)
        return {
          ph: parseInt(hex.substring(0, 4), 16) / 100,
          tdsLevel: parseInt(hex.substring(4, 8), 16) / 10,
          temperature: parseInt(hex.substring(8, 12), 16) / 10,
        };
      }

      // Unknown prefix
      return null;
    } catch {
      return null;
    }
  }

  // ----- Fetch dengan timeout -----
  private async attemptFetch(opts: FetchAttemptOptions) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(opts.url, {
        method: "GET",
        headers: opts.headers,
        redirect: "follow",
        signal: controller.signal,
      });
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async fetchLatestReading(): Promise<ExternalDatabaseReading | null> {
    const baseHeaders: Record<string, string> = {
      "X-API-KEY": this.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "HydroMonitor/1.0",
    };
    if (this.cfAccessClientId && this.cfAccessClientSecret) {
      baseHeaders["CF-Access-Client-Id"] = this.cfAccessClientId;
      baseHeaders["CF-Access-Client-Secret"] = this.cfAccessClientSecret;
    }

    let response: Response | null = null;
    let urlToHit = this.apiUrl;

    // --- Coba dengan header; jika 401 & diizinkan, fallback pakai ?key=... (buat tes via browser/proxy) ---
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        response = await this.attemptFetch({
          url: urlToHit,
          headers: baseHeaders,
          timeoutMs: this.timeoutMs,
        });

        // Kalau unauthorized & fallback diizinkan → coba ulang pakai query key
        if (
          response.status === 401 &&
          this.allowQueryKeyFallback &&
          !/[?&]key=/.test(urlToHit)
        ) {
          const sep = urlToHit.includes("?") ? "&" : "?";
          urlToHit = `${urlToHit}${sep}key=${encodeURIComponent(this.apiKey)}`;
          // lakukan 1x percobaan lagi langsung
          response = await this.attemptFetch({
            url: urlToHit,
            headers: { ...baseHeaders, "X-API-KEY": "" }, // kosongkan header supaya jelas tes via query
            timeoutMs: this.timeoutMs,
          });
        }

        break; // keluar loop jika sudah dapat response
      } catch (err: any) {
        if (err?.name === "AbortError" && attempt < this.maxAttempts) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        throw err;
      }
    }

    if (!response) throw new Error("No response from external database");

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `External DB error: ${response.status} ${response.statusText} ${text}`
      );
    }

    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      throw new Error(`Expected JSON, got ${ct}`);
    }

    const data = (await response.json()) as any;

    // Bentuk 1 (langsung payload decoding):
    let deviceCode =
      data.device_code ||
      data.device ||
      data.code ||
      process.env.EXTERNAL_DB_DEVICE ||
      "UNKNOWN";

    // Bentuk 2 (kalau server membungkus data di 'reading'):
    const encodedData =
      data.reading?.encoded_data ??
      data.encoded_data ??
      data.hex ??
      data.payload;

    if (!encodedData) {
      // Bisa jadi server sudah mengembalikan schema final (tanpa hex)
      if (
        typeof data.temperature === "number" &&
        ("ph" in data || "tdsLevel" in data || "ec" in data)
      ) {
        return {
          id: data.id || data._id || `ext_${Date.now()}`,
          temperature: Number(data.temperature) || 0,
          ph: Number(data.ph) || 0,
          tdsLevel: Number(data.tdsLevel ?? data.ec ?? 0) || 0,
          timestamp:
            data.timestamp || data.created_at || data.time || new Date().toISOString(),
        };
      }
      return null;
    }

    // Decode HEX → adapt ke schema
    const decoded = this.decodeHexData(String(encodedData), String(deviceCode));
    if (!decoded) return null;

    const adapted: ExternalDatabaseReading = {
      id:
        data.id ||
        data._id ||
        data.reading_id ||
        data.reading?.id ||
        `ext_${Date.now()}`,
      temperature: Number(decoded.temperature ?? 0) || 0,
      ph: Number(decoded.ph ?? 0) || 0,
      tdsLevel: Number(decoded.tdsLevel ?? decoded.ec ?? 0) || 0,
      timestamp:
        data.reading?.timestamp ||
        data.timestamp ||
        data.created_at ||
        data.time ||
        new Date().toISOString(),
    };

    return adapted;
  }
}

// --------------------
// SINGLETON INSTANCE
// --------------------
// ENV yang dipakai:
// - EXTERNAL_DB_API_URL  → bisa origin (https://app.up.railway.app) atau full endpoint
// - EXTERNAL_DB_DEVICE   → default: HZ1 (kalau EXTERNAL_DB_API_URL bukan endpoint langsung)
// - EXTERNAL_DB_API_KEY  → kalau tidak ada, fallback ke API_KEY (server)
const EXTERNAL_URL =
  process.env.EXTERNAL_DB_API_URL ||
  process.env.EXTERNAL_DB_ORIGIN ||
  "https://web-production-e195b.up.railway.app"; // origin; akan dibentuk /api/latest-readings/HZ1

const EXTERNAL_KEY =
  process.env.EXTERNAL_DB_API_KEY || process.env.API_KEY || "";

export const externalDatabaseService = new ExternalDatabaseService(
  EXTERNAL_URL,
  EXTERNAL_KEY
);

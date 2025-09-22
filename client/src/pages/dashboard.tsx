import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sprout, Settings, Cpu } from "lucide-react";
import StatusCard from "@/components/status-card";
import MultiMetricChart from "@/components/multi-metric-chart";
import RecentReadings from "@/components/recent-readings";
import SystemInfo from "@/components/system-info";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  AlertCircle,
  Wifi,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { SensorReading, SystemStatus } from "@shared/schema";
import { useState, useCallback } from "react"; // Import useState and useCallback

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false); // State for sync status

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      // Assuming syncAntaresData is defined elsewhere or this is the actual API call
      // For this example, I'll keep the original apiRequest call
      const response = await apiRequest("POST", "/api/sync-antares");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sensor-readings"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/sensor-readings/latest"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/system-status"] });
      toast({
        title: "Sync successful",
        description: "Data has been synced from Antares IoT platform.",
      });
    },
    onError: (error) => {
      toast({
        title: "Sync failed",
        description: "Failed to sync data from Antares IoT platform.",
        variant: "destructive",
      });
    },
  });

  const handleSyncData = useCallback(async () => {
    setIsSyncing(true);
    try {
      // Assuming syncAntaresData is defined elsewhere or this is the actual API call
      // For this example, I'll keep the original apiRequest call
      await apiRequest("POST", "/api/sync-antares");
      toast({
        title: "Data synced successfully",
        description: "Latest data has been fetched from Antares IoT platform.",
      });
      // Refetch data after sync
      queryClient.invalidateQueries({ queryKey: ["/api/sensor-readings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-status"] });
    } catch (error) {
      toast({
        title: "Sync failed",
        description: "Failed to sync data from Antares IoT platform.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  }, [toast, queryClient]);

  const { data: sensorReadings = [], isLoading: readingsLoading } = useQuery<
    SensorReading[]
  >({
    queryKey: ["/api/sensor-readings"],
    refetchInterval: 30000, // Refresh every 30 seconds instead of 10
    retry: 2, // Limit retries to 2
    retryDelay: 5000, // Wait 5 seconds between retries
  });

  const { data: latestReading } = useQuery<SensorReading | null>({
    queryKey: ["/api/sensor-readings/latest"],
    refetchInterval: 30000, // Refresh every 30 seconds instead of 10
    retry: 2, // Limit retries to 2
    retryDelay: 5000, // Wait 5 seconds between retries
  });

  const { data: systemStatus } = useQuery<SystemStatus>({
    queryKey: ["/api/system-status"],
    refetchInterval: 30000, // Refresh every 30 seconds instead of 10
    retry: 2, // Limit retries to 2
    retryDelay: 5000, // Wait 5 seconds between retries
  });

  // Connection status component
  const ConnectionStatus = () => {
    const isConnected = systemStatus?.connectionStatus === "connected";
    const isError = systemStatus?.connectionStatus === "error";

    return (
      <div className="flex items-center justify-center mb-4">
        <div
          className={`flex items-center space-x-2 px-4 py-2 rounded-full border ${
            isConnected
              ? "bg-green-50 border-green-200 text-green-700"
              : isError
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-yellow-50 border-yellow-200 text-yellow-700"
          }`}
          aria-live="polite"
        >
          {isConnected ? (
            <>
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              <Wifi className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-medium">
                Connected to Antares IoT
              </span>
            </>
          ) : isError ? (
            <>
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <WifiOff className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-medium">Connection Error</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="text-sm font-medium">Connecting...</span>
            </>
          )}
        </div>

        <Button
          onClick={handleSyncData}
          disabled={syncMutation.isPending || isSyncing}
          variant="outline"
          size="sm"
          className="ml-3"
          aria-label={
            syncMutation.isPending || isSyncing
              ? "Syncing data"
              : "Sync data now"
          }
        >
          {syncMutation.isPending || isSyncing ? (
            <>
              <RefreshCw
                className="h-4 w-4 mr-2 animate-spin"
                aria-hidden="true"
              />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Sync Now
            </>
          )}
        </Button>
      </div>
    );
  };

  const getOptimalityStatus = (value: number, min: number, max: number) => {
    if (value >= min && value <= max) return "optimal";
    if (Math.abs(value - min) < Math.abs(value - max)) return "low";
    return "high";
  };

  const getTemperatureStatus = (temp: number) =>
    getOptimalityStatus(temp, 22, 26);
  const getPhStatus = (ph: number) => getOptimalityStatus(ph, 5.5, 6.5);
  const getTdsLevelStatus = (tds: number) =>
    getOptimalityStatus(tds, 800, 1200);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Sprout className="h-6 w-6 text-green-600" />
                <h1 className="text-xl font-semibold text-slate-900">
                  HydroMonitor
                </h1>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncData}
                disabled={syncMutation.isPending || isSyncing}
                className="text-green-600 border-green-600 hover:bg-green-50"
              >
                Sync Data
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <ConnectionStatus />
        {/* Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatusCard
            title="Temperature"
            value={latestReading?.temperature ?? 0}
            unit="°C"
            icon="thermometer"
            trend={
              sensorReadings.length >= 2 && latestReading
                ? latestReading.temperature - sensorReadings[1].temperature
                : 0
            }
            status={
              latestReading
                ? getTemperatureStatus(latestReading.temperature)
                : "unknown"
            }
            optimalRange="22-26°C"
          />

          <StatusCard
            title="pH Level"
            value={latestReading?.ph ?? 0}
            unit=""
            icon="flask"
            trend={
              sensorReadings.length >= 2 && latestReading
                ? latestReading.ph - sensorReadings[1].ph
                : 0
            }
            status={latestReading ? getPhStatus(latestReading.ph) : "unknown"}
            optimalRange="5.5-6.5"
          />
          <StatusCard
            title="TDS Level"
            value={latestReading?.tdsLevel ?? 0}
            unit="ppm"
            icon="waves"
            trend={
              sensorReadings.length >= 2 && latestReading
                ? latestReading.tdsLevel - sensorReadings[1].tdsLevel
                : 0
            }
            status={
              latestReading
                ? getTdsLevelStatus(latestReading.tdsLevel)
                : "unknown"
            }
            optimalRange="800-1200 ppm"
          />
        </div>

        {/* Chart Section */}
        <div className="mb-8">
          <MultiMetricChart data={sensorReadings} isLoading={readingsLoading} />
        </div>

        {/* Recent Readings Section */}
        <div className="mb-8">
          <RecentReadings data={sensorReadings} isLoading={readingsLoading} />
        </div>

        {/* Detailed Data Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SystemInfo systemStatus={systemStatus} />
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between space-y-2 sm:space-y-0">
            <div className="text-sm text-slate-600">
              © 2025 HydroMonitor - DRPTM Hydroponic System
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

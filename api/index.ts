import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "../server/routes";

const app = express();

// Enable CORS for Vercel
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['X-CSRF-Token', 'X-Requested-With', 'Accept', 'Accept-Version', 'Content-Length', 'Content-MD5', 'Content-Type', 'Date', 'X-Api-Version']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Initialize routes synchronously
let routesInitialized = false;

const initializeRoutes = async () => {
  if (!routesInitialized) {
    try {
      console.log("Initializing routes...");
      await registerRoutes(app);
      routesInitialized = true;
      console.log("Routes initialized successfully");
    } catch (error) {
      console.error("Failed to initialize routes:", error);
      throw error;
    }
  }
};

// Initialize routes immediately
initializeRoutes().catch((error) => {
  console.error("Critical error during route initialization:", error);
});

// Middleware to ensure routes are initialized before handling requests
app.use(async (req, res, next) => {
  try {
    await initializeRoutes();
    next();
  } catch (error) {
    console.error("Route initialization error:", error);
    return res.status(500).json({ 
      error: "Server initialization failed",
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// Error handling
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  
  console.error("API Error:", err);
  res.status(status).json({ 
    error: message,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

export default app;

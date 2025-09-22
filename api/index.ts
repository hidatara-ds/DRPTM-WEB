import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "../server/routes";

const app = express();

// Enable CORS for Vercel
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Error handling
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  
  console.error("API Error:", err);
  res.status(status).json({ message });
});

// Initialize routes asynchronously
let routesInitialized = false;

app.use(async (req, res, next) => {
  if (!routesInitialized) {
    try {
      await registerRoutes(app);
      routesInitialized = true;
    } catch (error) {
      console.error("Failed to initialize routes:", error);
      return res.status(500).json({ error: "Failed to initialize server" });
    }
  }
  next();
});

export default app;

import express from "express";
import http from "http";
import { Server } from "socket.io";
import session from "express-session";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Import custom modules
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import { requireAuth, requireAdmin } from "./middleware/auth.js";
import { setupSignaling } from "./sockets/signaling.js";
import { logger } from "./utils/logger.js";
import { db } from "./db/index.js"; // Ensures db connection and table creation runs

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust the reverse proxy (Caddy) to support secure cookies over HTTPS
app.set("trust proxy", 1);

const server = http.createServer(app);

// Setup Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "fallback_default_session_secret_xyz_123";
const NODE_ENV = process.env.NODE_ENV || "development";

// Security - Helmet configuration with custom CSP rules to support WebSockets and video blobs
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:", "stun:", "turn:", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:", "mediastream:"]
      }
    }
  })
);

// Security - Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security - Rate limiting on API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});
// app.use("/api/", apiLimiter);

// Express Session Middleware configuration
const sessionMiddleware = session({
  name: "sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

app.use(sessionMiddleware);

// Share session middleware with Socket.IO
io.engine.use(sessionMiddleware);

// Static assets (CSS, JS, images) - publically accessible
app.use("/css", express.static(path.join(__dirname, "../public/css")));
app.use("/js", express.static(path.join(__dirname, "../public/js")));
app.use("/assets", express.static(path.join(__dirname, "../public/assets")));

// Custom Page Routing (Security: protects app and admin HTML templates)
app.get("/login.html", (req, res) => {
  // If user is accessing via invite link, redirect directly to app.html to join anonymously
  if (req.query.invite) {
    return res.redirect(`/app.html?invite=${encodeURIComponent(req.query.invite)}`);
  }
  // If user is already logged in and there is no error/info, redirect to lobby.html
  if (req.session && req.session.userId && !req.query.error && !req.query.info) {
    return res.redirect("/lobby.html");
  }
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

app.get("/lobby.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/lobby.html"));
});

app.get("/app.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/app.html"));
});

app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

// Root route redirection
app.get("/", (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect("/lobby.html");
  }
  return res.redirect("/login.html");
});

// Bind API Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

// Page fallback for unauthorized access or missing pages
app.use((req, res, next) => {
  res.status(404).redirect("/");
});

// Initialize Socket.IO Signaling logic
setupSignaling(io);

// Start the server
server.listen(PORT, () => {
  logger.info(`Watch Together server running in ${NODE_ENV} mode on port ${PORT}`);
});

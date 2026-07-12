import express from "express";
import http from "http";
import { Server } from "socket.io";
import session from "express-session";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Custom route modules and socket controllers
import authRoutes from "./routes/auth.js";
import partyRoutes from "./routes/party.js";
import { requireAuth, requireAdmin } from "./middleware/auth.js";
import { setupChatSocket } from "./sockets/chat.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS rules
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5678;
const SESSION_SECRET = process.env.SESSION_SECRET || "fallback_default_session_secret_998877";
const NODE_ENV = process.env.NODE_ENV || "development";

// Trust Caddy reverse proxy to pass HTTPS headers for secure session cookies
app.set("trust proxy", 1);

// Security - Helmet config with tailored CSP rules to permit media streams, WebSockets, and WHIP/STUN traversal
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:", "stun:", "turn:", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:", "mediastream:"]
      }
    }
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to strip trailing slashes from incoming URLs to prevent routing 404s
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith("/")) {
    const cleanPath = req.path.slice(0, -1);
    const query = req.url.substring(req.path.length);
    return res.redirect(301, cleanPath + query);
  }
  next();
});

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

// Expose static assets publicly
app.use("/css", express.static(path.join(__dirname, "../public/css")));
app.use("/js", express.static(path.join(__dirname, "../public/js")));

// Secure page routing (clean URL and .html extension aliases)
app.get(["/lobby", "/lobby.html"], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/lobby.html"));
});

app.get(["/app", "/app.html"], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/app.html"));
});

app.get(["/admin", "/admin.html"], requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

// Public pages (clean URL and .html extension aliases)
app.get(["/login", "/login.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

app.get(["/signup", "/signup.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/signup.html"));
});

// Root redirection
app.get("/", (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect("/lobby.html");
  }
  return res.redirect("/login.html");
});

// Bind API Routes
app.use("/api/auth", authRoutes);
app.use("/api/parties", partyRoutes);

// Fallback redirect for page misses
app.use((req, res) => {
  res.status(404).redirect("/");
});

// Initialize WebSocket Chat Server controllers
setupChatSocket(io);

// Start the server
server.listen(PORT, () => {
  console.log(`[SERVER] Watch Together running in ${NODE_ENV} mode on port ${PORT}`);
});

import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Maps token -> { createdBy: userId, expiresAt: date }
export const activeInviteTokens = new Map();

// Track active sessions to support duplicate login prevention
export const activeUserSessions = new Map(); // email -> session.id


router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const userList = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).all();
    if (userList.length === 0) {
      logger.connectionFailed(email.trim(), "Invalid email or password");
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = userList[0];

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      logger.connectionFailed(email.trim(), "Invalid email or password");
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Role-based hasAccess check
    if (user.role !== "admin" && !user.hasAccess) {
      const inviteToken = req.body.invite;
      let hasValidInvite = false;

      if (inviteToken && activeInviteTokens.has(inviteToken)) {
        const inviteData = activeInviteTokens.get(inviteToken);
        if (new Date() < inviteData.expiresAt) {
          hasValidInvite = true;
          activeInviteTokens.delete(inviteToken); // consume token
        }
      }

      if (!hasValidInvite) {
        logger.connectionFailed(email.trim(), "Permission denied (hasAccess = false)");
        return res.status(403).json({
          error: "You don't currently have permission to use this application. Please contact the administrator."
        });
      }

      req.session.bypassAccess = true;
    }

    // Duplicate Login handling
    const duplicateLoginBehavior = process.env.DUPLICATE_LOGIN_BEHAVIOR || "disconnect";
    const existingSessionId = activeUserSessions.get(user.email);

    if (existingSessionId && existingSessionId !== req.session.id) {
      if (duplicateLoginBehavior === "reject") {
        logger.connectionFailed(email.trim(), "Duplicate login rejected");
        return res.status(409).json({ error: "User is already logged in elsewhere." });
      } else {
        if (req.sessionStore && typeof req.sessionStore.destroy === "function") {
          req.sessionStore.destroy(existingSessionId, (err) => {
            if (err) console.error("Error destroying old session:", err);
          });
        }
        logger.info(`Duplicate login for user ${user.email}. Disconnected old session.`);
      }
    }

    // Establish session
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;

    activeUserSessions.set(user.email, req.session.id);

    logger.userLogin(user.email);

    return res.json({
      message: "Login successful.",
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logger.error("Login endpoint error", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

router.post("/logout", (req, res) => {
  const email = req.session?.email;
  if (req.session) {
    if (email) {
      activeUserSessions.delete(email);
      logger.userLogout(email);
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out." });
      }
      res.clearCookie("sid"); // clear session cookie
      return res.json({ message: "Logout successful." });
    });
  } else {
    return res.json({ message: "No active session." });
  }
});

router.get("/me", requireAuth, (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      hasAccess: req.user.hasAccess || req.session.bypassAccess === true,
      isGuest: req.session.isGuest === true,
      isGuestRequestPending: req.session.isGuestRequestPending === true
    }
  });
});

// Generate Invite Link (accessible only to users with access)
router.post("/invite", requireAuth, (req, res) => {
  const token = crypto.randomBytes(16).toString("hex");
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
  
  activeInviteTokens.set(token, {
    createdBy: req.session.userId,
    expiresAt: expiry
  });

  const inviteLink = `${req.protocol}://${req.get("host")}/app.html?invite=${token}`;
  return res.json({ inviteLink });
});

export default router;

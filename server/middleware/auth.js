import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { activeInviteTokens } from "../routes/auth.js";
import crypto from "crypto";

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Middleware to check if user is authenticated and has access.
 */
function requireAuthLogic(req, res, next) {
  if (!req.session || !req.session.userId) {
    const inviteToken = req.query.invite;
    if (inviteToken && activeInviteTokens.has(inviteToken)) {
      const inviteData = activeInviteTokens.get(inviteToken);
      if (new Date() < inviteData.expiresAt) {
        req.session.userId = "guest-" + crypto.randomBytes(8).toString("hex");
        req.session.email = "Guest";
        req.session.role = "user";
        req.session.isGuest = true;
        req.session.isGuestRequestPending = true;
        req.session.inviteToken = inviteToken;
        return req.session.save((err) => {
          if (err) console.error("[AUTH] Error saving anonymous guest session:", err);
          return next();
        });
      }
    }

    const inviteQuery = req.query.invite ? `?invite=${encodeURIComponent(req.query.invite)}` : "";
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    return res.redirect(`/login.html${inviteQuery}`);
  }

  try {
    if (req.session.isGuest) {
      req.user = {
        id: req.session.userId,
        email: req.session.email,
        role: "user",
        hasAccess: true
      };

      // Guests are restricted strictly to /app.html and its supporting api/socket routes
      const reqPath = req.path;
      if (reqPath.endsWith(".html") && reqPath !== "/app.html") {
        console.log(`[AUTH] Guest user ${req.session.email} restricted from accessing ${reqPath}, redirecting to /app.html`);
        return res.redirect("/app.html");
      }
      return next();
    }

    const userList = db.select().from(users).where(eq(users.id, req.session.userId)).all();
    if (userList.length === 0) {
      req.session.destroy(() => {});
      if (req.originalUrl.startsWith("/api/")) {
        return res.status(401).json({ error: "User not found." });
      }
      return res.redirect("/login.html");
    }

    const user = userList[0];
    
    if (user.role !== "admin" && !user.hasAccess && req.session.bypassAccess !== true) {
      const inviteToken = req.query.invite || (req.body && req.body.invite);
      let hasValidInvite = false;

      if (inviteToken && activeInviteTokens.has(inviteToken)) {
        const inviteData = activeInviteTokens.get(inviteToken);
        if (new Date() < inviteData.expiresAt) {
          hasValidInvite = true;
          activeInviteTokens.delete(inviteToken);
          req.session.bypassAccess = true;
        }
      }

      if (!hasValidInvite) {
        if (req.originalUrl.startsWith("/api/")) {
          return res.status(403).json({ 
            error: "You don't currently have permission to use this application. Please contact the administrator." 
          });
        }
        return res.redirect("/login.html?error=no_access");
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
}

export const requireAuth = asyncHandler(requireAuthLogic);

/**
 * Middleware to verify admin status.
 */
function requireAdminLogic(req, res, next) {
  requireAuthLogic(req, res, () => {
    if (!req.user || req.user.role !== "admin") {
      if (req.originalUrl.startsWith("/api/")) {
        return res.status(403).json({ error: "Forbidden: Administrator access required." });
      }
      return res.redirect("/app.html");
    }
    next();
  });
}

export const requireAdmin = asyncHandler(requireAdminLogic);

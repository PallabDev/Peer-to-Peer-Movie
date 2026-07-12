import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(401).json({ error: "Unauthorized. Please sign in." });
    }
    
    // Allow unauthenticated users to access app.html ONLY if they have a party query param
    // (This allows them to render the guest name input modal to join anonymously)
    const partyId = req.query.party;
    if (partyId && req.path === "/app.html") {
      return next();
    }
    
    return res.redirect("/login.html");
  }
  
  // If user is a guest, bypass DB validation (they are temporary session-only users)
  if (req.session.isGuest) {
    return next();
  }
  
  // Verify registered user in the database
  try {
    const userList = await db.select().from(users).where(eq(users.id, req.session.userId));
    if (userList.length === 0) {
      req.session.destroy(() => {});
      if (req.originalUrl.startsWith("/api/")) {
        return res.status(401).json({ error: "User not found." });
      }
      return res.redirect("/login.html");
    }
    
    const user = userList[0];
    
    // Check permission to login
    if (user.role !== "admin" && !user.hasAccess) {
      req.session.destroy(() => {});
      if (req.originalUrl.startsWith("/api/")) {
        return res.status(403).json({ error: "Your access request is pending administrator approval." });
      }
      return res.redirect("/login.html?error=pending");
    }
    
    req.user = user;
    next();
  } catch (err) {
    console.error("[AUTH MIDDLEWARE] Database error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== "admin") {
      if (req.originalUrl.startsWith("/api/")) {
        return res.status(403).json({ error: "Forbidden: Admin access required." });
      }
      return res.redirect("/lobby.html");
    }
    next();
  });
}

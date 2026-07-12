import { logger } from "../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { activeInviteTokens } from "../routes/auth.js";


export function setupSignaling(io) {
  // Map of socket.id -> { email, userId, role }
  const connectedUsers = new Map();
  const ROOM_NAME = "watch-room";

  // Reusable helper to bind all WebRTC signaling, chat, and presence listeners
  function registerSignalingListeners(socket, emailAddress, userRole) {
    socket.on("offer", (data) => {
      socket.to(ROOM_NAME).emit("offer", data);
    });

    socket.on("answer", (data) => {
      socket.to(ROOM_NAME).emit("answer", data);
    });

    socket.on("ice-candidate", (data) => {
      socket.to(ROOM_NAME).emit("ice-candidate", data);
    });

    socket.on("chat:send", (data) => {
      socket.to(ROOM_NAME).emit("chat:receive", {
        email: emailAddress,
        text: data.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    });

    socket.on("typing:start", () => {
      socket.to(ROOM_NAME).emit("typing:start", { email: emailAddress });
    });

    socket.on("typing:stop", () => {
      socket.to(ROOM_NAME).emit("typing:stop", { email: emailAddress });
    });

    socket.on("share:start", () => {
      logger.startedScreenShare(emailAddress);
      socket.to(ROOM_NAME).emit("share:start", { email: emailAddress });
    });

    socket.on("share:stop", () => {
      logger.stoppedScreenShare(emailAddress);
      socket.to(ROOM_NAME).emit("share:stop", { email: emailAddress });
    });



    socket.on("user:online", () => {
      socket.to(ROOM_NAME).emit("user:online", { email: emailAddress });
    });

    socket.on("user:offline", () => {
      socket.to(ROOM_NAME).emit("user:offline", { email: emailAddress });
    });
  }

  io.on("connection", async (socket) => {
    // Session validation via Express-session (shared with Engine.IO)
    const session = socket.request.session;
    if (!session || !session.userId) {
      logger.connectionFailed("unknown", "Unauthenticated socket connection attempt");
      socket.emit("auth_error", { message: "Unauthorized. Please log in." });
      socket.disconnect(true);
      return;
    }

    const { userId, email, role } = session;

    // Verify user still exists and has access in the DB (only for non-guest users)
    try {
      if (session.isGuest === true) {
        console.log(`[SIGNALLING] Guest socket ${socket.id} (name: ${email}) bypassing database validation.`);
      } else {
        const userList = db.select().from(users).where(eq(users.id, userId)).all();
        if (userList.length === 0) {
          socket.emit("auth_error", { message: "User not found." });
          setTimeout(() => socket.disconnect(true), 100);
          return;
        }
        
        const user = userList[0];
        if (user.role !== "admin" && !user.hasAccess && session.bypassAccess !== true) {
          socket.emit("auth_error", { 
            message: "You don't currently have permission to use this application. Please contact the administrator." 
          });
          setTimeout(() => socket.disconnect(true), 100);
          return;
        }
      }
    } catch (dbErr) {
      logger.error("DB check failed during socket connection", dbErr);
      socket.emit("server_error", { message: "Internal server error." });
      setTimeout(() => socket.disconnect(true), 100);
      return;
    }

    // Handle Duplicate Logins at Socket Level
    const duplicateLoginBehavior = process.env.DUPLICATE_LOGIN_BEHAVIOR || "disconnect";

    console.log(`[SIGNALLING] Checking duplicates for email: ${email}. Connected users count: ${connectedUsers.size}`);
    for (const [sid, info] of connectedUsers.entries()) {
      if (info.email === email) {
        console.log(`[SIGNALLING] Found duplicate socket: ${sid} for email: ${email}`);
        if (duplicateLoginBehavior === "reject") {
          logger.connectionFailed(email, "Duplicate socket connection rejected");
          console.log(`[SIGNALLING] Rejecting duplicate connection for ${email}`);
          socket.emit("auth_error", { message: "User is already active in a session." });
          setTimeout(() => socket.disconnect(true), 100);
          return;
        } else {
          // Disconnect existing socket
          logger.info(`Disconnecting duplicate socket session for ${email}`);
          const oldSocket = io.sockets.sockets.get(sid);
          if (oldSocket) {
            console.log(`[SIGNALLING] Force disconnecting duplicate old socket: ${sid}`);
            oldSocket.emit("force_logout", { message: "Logged in from another location." });
            setTimeout(() => {
              try {
                oldSocket.removeAllListeners();
                oldSocket.disconnect(true);
              } catch (e) {
                logger.error("Failed to disconnect old socket", e);
              }
            }, 100);
          } else {
            console.log(`[SIGNALLING] Old socket ${sid} not found in io.sockets.sockets`);
          }
          connectedUsers.delete(sid);
        }
      }
    }

    // If guest and pending approval, wait for request
    if (session.isGuest && session.isGuestRequestPending) {
      socket.on("guest:request_join", (data) => {
        const activeClients = io.sockets.adapter.rooms.get(ROOM_NAME);
        const numClients = activeClients ? activeClients.size : 0;

        if (numClients >= 2) {
          socket.emit("guest:request_error", { message: "Room is full. Maximum 2 users allowed." });
          return;
        }

        const guestName = (data.name || "Guest").trim();
        session.guestName = guestName;
        session.save((err) => {
          if (err) console.error("Error saving guest session:", err);
        });

        logger.info(`Guest '${guestName}' requesting to join watch room.`);

        // Find the host/admin in the room
        let hostSocketFound = false;
        for (const [sid, info] of connectedUsers.entries()) {
          if (info.role === "admin" || !info.isGuest) {
            const hostSocket = io.sockets.sockets.get(sid);
            if (hostSocket) {
              hostSocket.emit("guest:join_request", { name: guestName, guestSocketId: socket.id });
              hostSocketFound = true;
            }
          }
        }

        if (!hostSocketFound) {
          socket.emit("guest:request_error", { message: "No host is currently online in the theater." });
        }
      });
      return;
    }

    // Room occupancy check for normal users (Max 2 users)
    const activeClients = io.sockets.adapter.rooms.get(ROOM_NAME);
    const numClients = activeClients ? activeClients.size : 0;

    if (numClients >= 2) {
      logger.connectionFailed(email, "Room is full (max 2 users)");
      socket.emit("room_full", { message: "Room is full. Maximum 2 users allowed." });
      socket.disconnect(true);
      return;
    }

    // Register user socket
    connectedUsers.set(socket.id, { email, userId, role, isGuest: session.isGuest === true });
    socket.join(ROOM_NAME);
    logger.peerConnected(email, socket.id);

    // Tell the new client they are authenticated
    socket.emit("authenticated", { email, role });

    // Notify other peer in the room
    socket.to(ROOM_NAME).emit("peer:join", { email });

    // Host Event listeners for managing Guest entry requests
    if (role === "admin" || !session.isGuest) {
      socket.on("host:accept_guest", (data) => {
        const { guestSocketId } = data;
        const guestSocket = io.sockets.sockets.get(guestSocketId);
        
        if (guestSocket && guestSocket.request.session.isGuestRequestPending) {
          // Double check room occupancy before admitting guest
          const currentOccupancy = io.sockets.adapter.rooms.get(ROOM_NAME);
          if (currentOccupancy && currentOccupancy.size >= 2) {
            socket.emit("guest:request_error", { message: "Room is full. Cannot accept guest." });
            return;
          }

          const guestName = guestSocket.request.session.guestName || "Guest";
          const guestEmail = `${guestName} (Guest)`;
          
          guestSocket.request.session.isGuestRequestPending = false;
          guestSocket.request.session.email = guestEmail;
          guestSocket.request.session.bypassAccess = true;
          
          const inviteToken = guestSocket.request.session.inviteToken;
          if (inviteToken) activeInviteTokens.delete(inviteToken); // consume invite code
          
          guestSocket.request.session.save((err) => {
            if (err) console.error("Error saving guest accept session:", err);
            
            guestSocket.join(ROOM_NAME);
            connectedUsers.set(guestSocket.id, { email: guestEmail, userId: guestSocket.request.session.userId, role: "user", isGuest: true });
            logger.peerConnected(guestEmail, guestSocket.id);
            
            // Register WebRTC, Chat, and Presence signaling events on the newly accepted guest socket
            registerSignalingListeners(guestSocket, guestEmail, "user");
            
            // Explicitly emit the authenticated socket event to set guest client status badge to 'Connected'
            guestSocket.emit("authenticated", { email: guestEmail, role: "user" });
            
            guestSocket.emit("host:accepted", { email: guestEmail });
            guestSocket.to(ROOM_NAME).emit("peer:join", { email: guestEmail });
          });
        }
      });

      socket.on("host:reject_guest", (data) => {
        const { guestSocketId } = data;
        const guestSocket = io.sockets.sockets.get(guestSocketId);
        if (guestSocket) {
          logger.info(`Host rejected guest join request from socket: ${guestSocketId}`);
          guestSocket.emit("host:rejected");
        }
      });
    }

    // Destroy Room (host only)
    socket.on("room:destroy", () => {
      if (role !== "admin") {
        socket.emit("server_error", { message: "Only the host can destroy the room." });
        return;
      }

      logger.info(`Room destroyed by host: ${email}`);

      // Notify all other peers in the room
      const room = io.sockets.adapter.rooms.get(ROOM_NAME);
      if (room) {
        for (const sid of room) {
          if (sid !== socket.id) {
            const peerSocket = io.sockets.sockets.get(sid);
            if (peerSocket) {
              peerSocket.emit("room:destroyed", { message: "Room has been destroyed by the host." });
              connectedUsers.delete(sid);
              peerSocket.leave(ROOM_NAME);
            }
          }
        }
      }

      // Confirm to host
      socket.emit("room:destroyed", { message: "Room destroyed. You can start a new session." });
    });

    // Register signaling listeners for authenticated users
    registerSignalingListeners(socket, email, role);

    // Disconnection Handler
    socket.on("disconnect", () => {
      console.log(`[SIGNALLING] socket disconnect event triggered for: ${socket.id}. Still in map: ${connectedUsers.has(socket.id)}`);
      if (connectedUsers.has(socket.id)) {
        logger.peerDisconnected(email, socket.id);
        connectedUsers.delete(socket.id);
        
        // Notify other peer that this user left
        console.log(`[SIGNALLING] Emitting peer:left for ${email}`);
        socket.to(ROOM_NAME).emit("peer:left", { email });

        // If host left, destroy the room for remaining peers
        if (role === "admin") {
          // Check if there are any other admin sockets still connected
          let otherAdminExists = false;
          for (const [sid, info] of connectedUsers.entries()) {
            if (sid !== socket.id && info.role === "admin") {
              otherAdminExists = true;
              break;
            }
          }

          console.log(`[SIGNALLING] Host left. Other active admin sockets exists: ${otherAdminExists}`);
          if (!otherAdminExists) {
            const room = io.sockets.adapter.rooms.get(ROOM_NAME);
            if (room) {
              console.log(`[SIGNALLING] Loop and destroy room for remaining ${room.size} clients`);
              for (const sid of room) {
                const peerSocket = io.sockets.sockets.get(sid);
                if (peerSocket) {
                  console.log(`[SIGNALLING] Sending room:destroyed to: ${sid}`);
                  peerSocket.emit("room:destroyed", { message: "Host left. Room has been destroyed." });
                  connectedUsers.delete(sid);
                  peerSocket.leave(ROOM_NAME);
                }
              }
            }
            logger.info(`Room destroyed: host ${email} disconnected`);
          } else {
            logger.info(`Host socket disconnected, but another host socket is still active for ${email}. Room preserved.`);
          }
        }
      }
    });
  });
}

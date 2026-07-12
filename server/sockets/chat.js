import { db } from "../db/index.js";
import { parties } from "../db/schema.js";
import { eq } from "drizzle-orm";

// Map of partyId -> Set of userId
export const activeRoomMembers = new Map();

// Map of socket.id -> { userId, email, role, partyId }
const socketConnections = new Map();

export function setupChatSocket(io) {
  io.on("connection", (socket) => {
    const session = socket.request.session;
    
    // Auth Validation: Socket must share a valid Express session
    if (!session || !session.userId) {
      console.warn(`[SOCKET] Unauthorized socket connection request: ${socket.id}`);
      socket.emit("error", { message: "Unauthorized. Please log in again." });
      socket.disconnect(true);
      return;
    }

    const { userId, email, role } = session;
    console.log(`[SOCKET] User connected: ${email} (Socket: ${socket.id})`);

    // Handle Join Party Room
    socket.on("join-party", async (data) => {
      const { partyId } = data;
      if (!partyId) {
        socket.emit("error", { message: "Invalid Party Room ID." });
        return;
      }

      try {
        // Query party details from database
        const partyList = await db.select().from(parties).where(eq(parties.id, partyId));
        if (partyList.length === 0) {
          socket.emit("error", { message: "Party room does not exist or has expired." });
          return;
        }

        const party = partyList[0];
        const isHost = userId === party.hostId;

        // Initialize room set if not exists
        if (!activeRoomMembers.has(partyId)) {
          activeRoomMembers.set(partyId, new Set());
        }

        const members = activeRoomMembers.get(partyId);

        // Enforce maximum capacity of 4 concurrent users
        // If room is full AND the user is not the host AND the user is not already in the members list
        if (members.size >= 4 && !members.has(userId) && !isHost) {
          socket.emit("room-full", { message: "Room is full. Maximum 4 users allowed." });
          setTimeout(() => socket.disconnect(true), 100);
          return;
        }

        // Add user to the room presence set
        members.add(userId);
        socket.partyId = partyId;
        
        // Save socket details to connections mapping
        socketConnections.set(socket.id, { userId, email, role, partyId });
        
        // Join the Socket.IO room channel
        socket.join(partyId);

        console.log(`[SOCKET] ${email} joined party room: ${partyId}. Active count: ${members.size}`);

        // Notify room that user joined
        io.to(partyId).emit("user-joined", {
          userId,
          email,
          role,
          count: members.size
        });

        // Send current list of active users to the client who just joined
        // We retrieve the active users' details by checking our connections map
        const activeUsersList = [];
        const seenUserIds = new Set();
        for (const [sid, conn] of socketConnections.entries()) {
          if (conn.partyId === partyId && !seenUserIds.has(conn.userId)) {
            seenUserIds.add(conn.userId);
            activeUsersList.push({
              userId: conn.userId,
              email: conn.email,
              role: conn.role,
              isHost: conn.userId === party.hostId
            });
          }
        }
        socket.emit("room-members", activeUsersList);

      } catch (err) {
        console.error("[SOCKET] Error joining party room:", err);
        socket.emit("error", { message: "Failed to join party room." });
      }
    });

    // Handle Chat Messages
    socket.on("chat-message", (data) => {
      const conn = socketConnections.get(socket.id);
      if (!conn || !conn.partyId) {
        socket.emit("error", { message: "You are not active in any party room." });
        return;
      }

      const text = (data.text || "").trim();
      if (!text) return;

      const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // Broadcast message to everyone in the party room
      io.to(conn.partyId).emit("chat-message", {
        userId: conn.userId,
        email: conn.email,
        text,
        timestamp
      });
    });

    // Handle Disconnections
    socket.on("disconnect", () => {
      console.log(`[SOCKET] User disconnected: ${email} (Socket: ${socket.id})`);
      const conn = socketConnections.get(socket.id);
      
      if (conn) {
        const { userId, email, partyId } = conn;
        socketConnections.delete(socket.id);

        if (partyId && activeRoomMembers.has(partyId)) {
          const members = activeRoomMembers.get(partyId);
          
          // Check if the user has any other active sockets in this room (multiple tabs)
          let hasOtherConnections = false;
          for (const [sid, c] of socketConnections.entries()) {
            if (c.userId === userId && c.partyId === partyId) {
              hasOtherConnections = true;
              break;
            }
          }

          // If no other tabs are open, completely remove them from the presence list
          if (!hasOtherConnections) {
            members.delete(userId);
            if (members.size === 0) {
              activeRoomMembers.delete(partyId);
            }

            console.log(`[SOCKET] ${email} left party room: ${partyId}. Active count: ${members.size}`);

            // Broadcast exit notifications to the room
            io.to(partyId).emit("user-left", {
              userId,
              email,
              count: members.size
            });
          }
        }
      }
    });
  });
}

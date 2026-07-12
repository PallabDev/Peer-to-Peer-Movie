# Watch Together (Private P2P) - Project Specification & Implementation Status

## Project Overview

A **private Watch Together web application** using **Node.js** that allows **exactly two authenticated users** to watch a movie together by screen sharing a movie player window using **WebRTC**.

The server **does not relay media**. It only handles:
- Authentication
- User management
- Signaling (WebRTC)
- Live chat
- Access control

Movie video/audio travels **peer-to-peer (P2P)**.

---

## Tech Stack

### Backend
- Node.js (ES Modules)
- Express.js 4.x
- Socket.IO 4.x
- WebRTC Signaling
- SQLite (better-sqlite3)
- Drizzle ORM
- bcrypt
- express-session
- Helmet
- express-rate-limit
- dotenv

### Frontend
- Static HTML
- TailwindCSS 4 (compiled locally)
- Vanilla JavaScript
- Socket.IO Client
- WebRTC APIs (browser-native)
- Outfit Google Font

---

## Folder Structure

```
project/
├── .env
├── package.json
├── drizzle.config.js
├── sqlite/
│   └── db.sqlite
├── server/
│   ├── index.js                 # Express + Socket.IO entry point
│   ├── routes/
│   │   ├── auth.js              # Login, logout, /me, invite endpoints
│   │   └── admin.js             # User CRUD for admins
│   ├── middleware/
│   │   └── auth.js              # requireAuth + requireAdmin middleware
│   ├── sockets/
│   │   └── signaling.js         # WebRTC signaling + chat + PTT
│   ├── db/
│   │   ├── index.js             # DB connection + table creation
│   │   ├── schema.js            # Drizzle ORM schema
│   │   └── seed.js              # Seed script for initial admin
│   └── utils/
│       └── logger.js            # Structured logger utility
├── public/
│   ├── login.html               # Login page
│   ├── app.html                 # Main theater page (with lobby overlay)
│   ├── admin.html               # Admin panel page
│   ├── css/
│   │   ├── input.css            # Tailwind CSS input
│   │   └── output.css           # Compiled Tailwind CSS output
│   └── js/
│       ├── app.js               # Theater/WebRTC client logic
│       ├── login.js             # Login form client logic
│       └── admin.js             # Admin panel client logic
└── drizzle/                     # Drizzle migrations (auto-generated)
```

---

## Database Schema

### Users Table

| Field       | Type      | Constraints                          |
|-------------|-----------|--------------------------------------|
| id          | INTEGER   | PRIMARY KEY AUTOINCREMENT            |
| email       | TEXT      | UNIQUE NOT NULL                      |
| password    | TEXT      | NOT NULL (bcrypt hashed)             |
| role        | TEXT      | DEFAULT 'user' NOT NULL ('admin'/'user') |
| has_access  | INTEGER   | DEFAULT 0 NOT NULL (boolean)         |
| created_at  | INTEGER   | NOT NULL (timestamp)                 |
| updated_at  | INTEGER   | NOT NULL (timestamp)                 |

No other tables. No chat table. No room table.

---

## Environment Variables

```
PORT=3000
SESSION_SECRET=a_very_secure_random_session_secret_123456
NODE_ENV=development
DUPLICATE_LOGIN_BEHAVIOR=disconnect
```

---

## API Endpoints

### Auth Routes (`/api/auth`)

| Method | Path      | Description                          | Auth Required |
|--------|-----------|--------------------------------------|---------------|
| POST   | /login    | Authenticate user by email/password  | No            |
| POST   | /logout   | Destroy session, clear cookie        | No            |
| GET    | /me       | Return current user profile          | Yes           |
| POST   | /invite   | Generate invite link (1hr expiry)    | Yes           |

### Admin Routes (`/api/admin`)

| Method | Path              | Description                    | Auth Required |
|--------|-------------------|--------------------------------|---------------|
| GET    | /users            | List all users (optional ?search=) | Admin     |
| POST   | /users            | Create new user                | Admin         |
| DELETE | /users/:id        | Delete user by ID              | Admin         |
| PATCH  | /users/:id        | Update role/access/password    | Admin         |

---

## Socket.IO Events

### Authentication
| Event         | Direction       | Description                    |
|---------------|-----------------|--------------------------------|
| authenticated | Server -> Client| Confirms auth success          |
| auth_error    | Server -> Client| Auth failure                   |
| server_error  | Server -> Client| Internal error                 |
| force_logout  | Server -> Client| Duplicate login disconnect     |
| room_full     | Server -> Client| Room at capacity               |

### Connection
| Event         | Direction       | Description                    |
|---------------|-----------------|--------------------------------|
| peer:join     | Server -> Client| Notifies other peer of join    |
| peer:left     | Server -> Client| Notifies other peer of leave   |

### WebRTC
| Event         | Direction       | Description                    |
|---------------|-----------------|--------------------------------|
| offer         | Bidirectional   | WebRTC SDP offer forwarding    |
| answer        | Bidirectional   | WebRTC SDP answer forwarding   |
| ice-candidate | Bidirectional   | ICE candidate forwarding       |

### Chat (Ephemeral)
| Event         | Direction       | Description                    |
|---------------|-----------------|--------------------------------|
| chat:send     | Client -> Server| Send chat message              |
| chat:receive  | Server -> Client| Receive chat message           |
| typing:start  | Bidirectional   | Typing indicator on            |
| typing:stop   | Bidirectional   | Typing indicator off           |

### Screen Sharing
| Event         | Direction       | Description                    |
|---------------|-----------------|--------------------------------|
| share:start   | Bidirectional   | Screen share started           |
| share:stop    | Bidirectional   | Screen share stopped           |

### Push To Talk
| Event         | Direction       | Description                    |
|---------------|-----------------|--------------------------------|
| ptt:start     | Bidirectional   | Mic activated                  |
| ptt:stop      | Bidirectional   | Mic deactivated                |

### Presence
| Event         | Direction       | Description                    |
|---------------|-----------------|--------------------------------|
| user:online   | Bidirectional   | User is online                 |
| user:offline  | Bidirectional   | User went offline/idle         |

### Room Management
| Event           | Direction       | Description                  |
|-----------------|-----------------|------------------------------|
| room:destroy    | Client -> Server| Host destroys room           |
| room:destroyed  | Server -> Client| Room was destroyed           |

### Guest Flow
| Event               | Direction       | Description              |
|---------------------|-----------------|--------------------------|
| guest:request_join  | Client -> Server| Guest requests to join    |
| guest:join_request  | Server -> Client| Host receives request     |
| host:accept_guest   | Client -> Server| Host accepts guest        |
| host:reject_guest   | Client -> Server| Host rejects guest        |
| host:accepted       | Server -> Client| Guest notified accepted   |
| host:rejected       | Server -> Client| Guest notified rejected   |

---

## Features Implemented

### Authentication
- Email/password login (NOT ID-based)
- Passwords hashed with bcrypt (salt rounds: 10)
- Session-based auth (express-session, HTTPOnly cookies)
- No JWT
- 24-hour session expiry

### Roles
- `admin` - Full access
- `user` - Access only when `hasAccess = true`

### Admin Panel
- Create users
- Delete users
- Reset/change passwords
- Enable/disable access
- Change roles
- Search users
- No registration page for users (admin creates them)

### Lobby (NEW)
- Shown after login, before entering room
- "Enter Room" button initiates socket connection
- Prevents auto-connect race conditions
- Shows room status/errors in lobby

### Rooms
- Single global room ("watch-room")
- Maximum 2 users
- Host (admin) can destroy room via trash button
- Room auto-destroyed when host disconnects
- Room auto-recreates when new users connect
- "Room Full" message when at capacity

### Live Chat
- Socket.IO based
- Instant messaging
- Typing indicator
- Auto scroll
- Timestamps
- Enter to send
- Messages NOT stored (ephemeral)
- Messages disappear on refresh

### Push To Talk
- Hold Spacebar OR hold button
- Microphone streams only while held
- Release = microphone stops
- No continuous streaming
- No voice activation

### Screen Sharing
- Uses `navigator.mediaDevices.getDisplayMedia()`
- User selects movie player window
- Stream only selected window
- Share system audio (browser support dependent)
- Stop sharing button
- Auto detect when sharing ends (browser toolbar)
- Notify peer

### WebRTC
- Server only for signaling + ICE exchange
- Media: P2P only
- STUN: `stun:stun.l.google.com:19302`
- TURN: optional (not implemented)
- If P2P fails: "Unable to establish direct connection."

### Connection Status Badges
- Connected/Disconnected/Room Full
- P2P On/Off/Connecting/Failed
- Peer presence: Online/Offline/Sharing Screen/Talking/Idle

### Notifications
- Toast notifications (success/warning/error/info)
- Auto-dismiss after 4 seconds
- Click to dismiss
- Examples: Peer Joined/Left, Started/Stopped Sharing, etc.

### User Presence
- Online, Offline, Sharing Screen, Talking, Idle
- Idle after 5 minutes of inactivity
- Realtime updates

### Duplicate Login Handling
- Configurable via `DUPLICATE_LOGIN_BEHAVIOR` env var
- `disconnect` (default): Disconnect old session
- `reject`: Reject new login

### Invite System
- Admin generates invite link
- Token expires after 1 hour
- Guest enters name -> host approves/rejects
- Maximum 2 users in room

### Security
- Password hashing (bcrypt)
- Session authentication
- HTTPOnly cookies
- Helmet (CSP configured for WebSockets, blobs, mediastream)
- Rate limiting (configured but disabled by default)
- Input validation
- Escape user input (XSS prevention)
- Session-based CSRF protection

### Server-Side Rate Limiting
- 2-second cooldown between socket connections per user
- Prevents rapid reconnection loops

---

## Client-Side Flow

### Regular User
1. Login -> `/login.html`
2. Redirect to `/app.html`
3. Auth check via `GET /api/auth/me`
4. **Lobby overlay shown** (socket NOT connected yet)
5. User clicks "Enter Room"
6. Socket connects (WebSocket only, no auto-reconnect)
7. Room joined, WebRTC setup
8. Chat, PTT, Screen Share available

### Guest User
1. Click invite link -> `/login.html?invite=TOKEN`
2. Login with email/password
3. Redirect to `/app.html`
4. Guest overlay shown (name input)
5. Enter name -> send join request
6. Host accepts -> enters room
7. Chat, PTT, Screen Share available

### Host Leaves
1. Host disconnects
2. Room auto-destroyed for remaining peers
3. Peers notified via `room:destroyed` event
4. Peers return to lobby
5. New room created when next user enters

---

## Key Fixes Applied

### 1. Async Middleware Error Handling
**Problem:** `requireAuth` and `requireAdmin` were `async` functions used as Express 4 middleware. Express 4 doesn't catch rejected promises, causing unhandled rejections that crash the server.

**Solution:** Wrapped with `asyncHandler` that catches rejected promises and forwards to Express error handler.

### 2. Socket Reconnection Loop
**Problem:** Socket.IO auto-reconnect created infinite connect/disconnect loops when server disconnected "duplicate" sockets.

**Solution:**
- Added lobby to defer socket connection until user clicks "Enter Room"
- `socketCreated` guard prevents multiple `io()` calls
- `transports: ["websocket"]` forces WebSocket only (prevents transport negotiation creating multiple connections)
- `removeAllListeners()` before disconnect on force_logout/auth_error

### 3. Room Management
**Problem:** No way to reset/destroy room when host leaves.

**Solution:**
- `room:destroy` event for manual room destruction (host only)
- Auto-destroy room when host disconnects
- Room auto-recreates when new users connect
- Lobby re-shown after room destruction

---

## Scripts

```json
{
  "start": "node server/index.js",
  "dev": "node server/index.js",
  "build:css": "npx @tailwindcss/cli -i ./public/css/input.css -o ./public/css/output.css",
  "watch:css": "npx @tailwindcss/cli -i ./public/css/input.css -o ./public/css/output.css --watch",
  "db:push": "drizzle-kit push"
}
```

### Setup
```bash
# Install dependencies
npm install

# Seed initial admin (email: admin@example.com, password: adminpassword123)
node server/db/seed.js

# Build CSS
npm run build:css

# Start server
npm start
```

---

## Default Admin Credentials

```
Email: admin@example.com
Password: adminpassword123
```

---

## Current Status

### Completed
- [x] Authentication (email/password, bcrypt, sessions)
- [x] Admin panel (CRUD users, roles, access control)
- [x] Lobby UI (defer socket connection)
- [x] Socket.IO signaling
- [x] WebRTC P2P connection
- [x] Screen sharing with system audio
- [x] Push-to-talk microphone
- [x] Ephemeral chat
- [x] Typing indicators
- [x] Toast notifications
- [x] User presence (Online/Offline/Sharing/Talking/Idle)
- [x] Invite link system
- [x] Guest join request flow
- [x] Room destroy/recreate
- [x] Duplicate login handling
- [x] Server-side rate limiting
- [x] Async middleware error handling
- [x] Dark mode UI (TailwindCSS)
- [x] Responsive design

### Not Yet Implemented
- [ ] TURN server (optional, for strict NAT environments)
- [ ] Persistent room state
- [ ] Multiple rooms
- [ ] User avatar/profile
- [ ] Message history persistence
- [ ] Email verification
- [ ] Password reset via email
- [ ] Rate limiting on API routes (configured but disabled)
- [ ] CSRF token validation
- [ ] Input sanitization library (currently manual escape)

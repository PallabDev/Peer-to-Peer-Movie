/**
 * Simple structured logger utility to log server events in a standard format.
 */
export const logger = {
  info(message, meta = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] ${message}`, Object.keys(meta).length ? meta : "");
  },
  error(message, error, meta = {}) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] ${message}`, error || "", Object.keys(meta).length ? meta : "");
  },
  
  // Custom helper events as specified in specification
  userLogin(username) {
    this.info(`User Logged In: ${username}`);
  },
  userLogout(username) {
    this.info(`User Logged Out: ${username}`);
  },
  peerConnected(username, socketId) {
    this.info(`Peer Connected: ${username} (Socket: ${socketId})`);
  },
  peerDisconnected(username, socketId) {
    this.info(`Peer Disconnected: ${username} (Socket: ${socketId})`);
  },
  startedScreenShare(username) {
    this.info(`Started Screen Share: ${username}`);
  },
  stoppedScreenShare(username) {
    this.info(`Stopped Screen Share: ${username}`);
  },
  connectionFailed(username, errorReason) {
    this.info(`Connection Failed for ${username || "unknown"}: ${errorReason}`);
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  // DOM Elements
  const navUsername = document.getElementById("nav-username");
  const adminPanelLink = document.getElementById("admin-panel-link");
  const logoutBtn = document.getElementById("logout-btn");
  
  const videoContainer = document.getElementById("video-container");
  const remoteVideo = document.getElementById("remote-video");
  const localVideo = document.getElementById("local-video");
  const localPreviewContainer = document.getElementById("local-preview-container");
  const videoPlaceholder = document.getElementById("video-placeholder");
  const placeholderStatus = document.getElementById("placeholder-status");
  const talkingIndicator = document.getElementById("talking-indicator");
  const talkingPeerName = document.getElementById("talking-peer-name");

  const shareScreenBtn = document.getElementById("share-screen-btn");
  const stopShareBtn = document.getElementById("stop-share-btn");
  const shareLinkBtn = document.getElementById("share-link-btn");
  const muteAudioBtn = document.getElementById("mute-audio-btn");
  const audioIconUnmuted = document.getElementById("audio-icon-unmuted");
  const audioIconMuted = document.getElementById("audio-icon-muted");
  const pipBtn = document.getElementById("pip-btn");
  const fullscreenBtn = document.getElementById("fullscreen-btn");
  const destroyRoomBtn = document.getElementById("destroy-room-btn");
  const roomStatusBadge = document.getElementById("room-status-badge");
  const webrtcStatusBadge = document.getElementById("webrtc-status-badge");
  const peerPresenceDot = document.getElementById("peer-presence-dot");
  const peerUsernameDisplay = document.getElementById("peer-username-display");
  const activeSharingBox = document.getElementById("active-sharing-box");
  const activeSharingMsg = document.getElementById("active-sharing-msg");

  const chatMessages = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const typingIndicator = document.getElementById("typing-indicator");
  const typingUsername = document.getElementById("typing-username");
  const toastContainer = document.getElementById("toast-container");

  // State Variables
  let socket = null;
  let currentUser = null;
  let peerEmail = null;
  let peerPresenceState = "Offline"; // Online, Offline, Sharing Screen, Talking, Idle
  
  let localScreenStream = null;
  let peerConnection = null;
  let screenSenders = []; // WebRTC senders for screen share (video + audio)
  const remoteCandidatesQueue = []; // Queue for buffering remote ICE candidates before remoteDescription is set
  let isMutedRemoteAudio = false;
  let isTyping = false;
  let typingTimeout = null;
  let idleTimeout = null;

  // WebRTC configurations
  const configuration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  };

  // Map to manage dynamic audio elements per remote track ID to avoid conflicts
  const remoteAudioElements = new Map(); // trackId -> HTMLAudioElement

  let socketCreated = false;

  // Initialize profile check
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      window.location.href = "/login.html?info=Session+expired";
      return;
    }
    const data = await res.json();
    currentUser = data.user;
    navUsername.textContent = currentUser.email;
    
    if (currentUser.role === "admin") {
      adminPanelLink.classList.remove("hidden");
      destroyRoomBtn.classList.remove("hidden");
    }
    
    if (currentUser.isGuest) {
      console.log("[THEATER] User is guest, hiding host-only control buttons");
      if (shareScreenBtn) shareScreenBtn.classList.add("hidden");
      if (stopShareBtn) stopShareBtn.classList.add("hidden");
      if (shareLinkBtn) shareLinkBtn.classList.add("hidden");
      if (muteAudioBtn) muteAudioBtn.classList.add("hidden");
      if (localPreviewContainer) localPreviewContainer.classList.add("hidden");
    }
    
    // Guests skip lobby - go straight to guest flow
    if (currentUser.isGuest) {
      document.getElementById("guest-overlay").classList.remove("hidden");
      if (currentUser.isGuestRequestPending) {
        showGuestStep("input");
        startSocketSignaling();
      } else {
        document.getElementById("guest-overlay").classList.add("hidden");
        startSocketSignaling();
        setupEventListeners();
      }
    } else {
      // Regular user: enter room instantly
      startSocketSignaling();
      setupEventListeners();
    }
  } catch (err) {
    console.error("Profile check failed:", err);
    window.location.href = "/login.html";
  }

  // Socket.IO signaling setups
  function startSocketSignaling() {
    if (socketCreated) return;
    socketCreated = true;
    
    console.log("[SOCKET] Initializing socket connection...");
    socket = io({ reconnection: false, transports: ["websocket"] });

    // Authenticated confirmation
    socket.on("authenticated", (data) => {
      console.log("[SOCKET] Authenticated event received:", data);
      roomStatusBadge.textContent = "Connected";
      roomStatusBadge.className = "text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full font-medium";
      showToast(`Joined room as ${data.email}`, "success");
      socket.emit("user:online");
      updatePresence("Online");
    });

    // Handle authentication error
    socket.on("auth_error", (data) => {
      console.error("[SOCKET] auth_error event received:", data);
      socket.removeAllListeners();
      socket.disconnect();
      console.log("[LOBBY REDIRECT] Redirecting to login.html due to auth_error");
      window.location.href = `/login.html?error=${encodeURIComponent(data.message)}`;
    });

    // Handle server error
    socket.on("server_error", (data) => {
      console.error("[SOCKET] server_error event received:", data);
      showToast(data.message, "error");
    });

    // Handle force logout (duplicate login)
    socket.on("force_logout", (data) => {
      console.warn("[SOCKET] force_logout event received:", data);
      socket.removeAllListeners();
      socket.disconnect();
      console.log("[LOBBY REDIRECT] Redirecting to login.html due to force_logout");
      window.location.href = `/login.html?error=${encodeURIComponent(data.message)}`;
    });

    // Handle rate limit
    socket.on("rate_limit", (data) => {
      console.error("[SOCKET] rate_limit event received:", data);
      showToast(data.message, "error");
      socket.removeAllListeners();
      socket.disconnect();
      console.log("[LOBBY REDIRECT] Redirecting to lobby.html due to rate_limit");
      setTimeout(() => {
        window.location.href = `/lobby.html?error=${encodeURIComponent(data.message)}`;
      }, 1500);
    });

    // Handle Room Full
    socket.on("room_full", (data) => {
      console.error("[SOCKET] room_full event received:", data);
      showToast(data.message, "error");
      placeholderStatus.textContent = "Room is full. Exactly two users allowed.";
      roomStatusBadge.textContent = "Room Full";
      roomStatusBadge.className = "text-xs bg-rose-500/10 text-rose-400 px-2.5 py-1 rounded-full font-medium";
      
      socket.removeAllListeners();
      socket.disconnect();
      console.log("[LOBBY REDIRECT] Redirecting to lobby/login due to room_full");
      setTimeout(() => {
        window.location.href = currentUser.isGuest ? "/login.html?error=room_full" : "/lobby.html?error=room_full";
      }, 1500);
    });

    // Handle room destroyed by host
    socket.on("room:destroyed", (data) => {
      console.warn("[SOCKET] room:destroyed event received:", data);
      showToast(data.message || "Room has been destroyed by host", "warning");
      closePeerConnection();
      peerEmail = null;
      updatePeerPresence("Offline");
      placeholderStatus.textContent = "Room was destroyed. Redirecting...";
      roomStatusBadge.textContent = "Disconnected";
      roomStatusBadge.className = "text-xs bg-rose-500/10 text-rose-400 px-2.5 py-1 rounded-full font-medium";
      
      socket.removeAllListeners();
      socket.disconnect();
      console.log("[LOBBY REDIRECT] Redirecting to lobby/login due to room:destroyed");
      setTimeout(() => {
        window.location.href = currentUser.isGuest ? "/login.html" : "/lobby.html";
      }, 2000);
    });

    // Peer Joined Room
    socket.on("peer:join", async (data) => {
      peerEmail = data.email;
      showToast(`${peerEmail} joined the room`, "info");
      updatePeerPresence("Online");
      
      // Initialize Peer Connection (we are the polite peer or let the offering happen)
      initPeerConnection();
      
      // Notify them we are online too
      socket.emit("user:online");

      // If we are the host (admin), initiate the WebRTC SDP offer
      if (currentUser && currentUser.role === "admin") {
        console.log("[WEBRTC] Host sending initial negotiation offer to the new peer");
        await negotiate();
      }
    });

    // Peer Left Room
    socket.on("peer:left", (data) => {
      showToast(`${data.email} left the room`, "warning");
      updatePeerPresence("Offline");
      closePeerConnection();
      peerEmail = null;
    });

    // WebRTC signaling forwards
    socket.on("offer", async (data) => {
      try {
        if (!peerConnection) initPeerConnection();
        // Modify remote description SDP to prefer high-fidelity audio
        const highFidRemoteOffer = new RTCSessionDescription({
          type: data.sdp.type || "offer",
          sdp: preferHighFidelityAudio(data.sdp.sdp || data.sdp)
        });
        await peerConnection.setRemoteDescription(highFidRemoteOffer);
        
        // Process any remote ICE candidates that arrived before the remote offer was set
        await processQueuedCandidates();
        
        const answer = await peerConnection.createAnswer();
        // Modify local answer SDP to prefer high-fidelity audio
        const highFidLocalAnswer = new RTCSessionDescription({
          type: answer.type,
          sdp: preferHighFidelityAudio(answer.sdp)
        });
        await peerConnection.setLocalDescription(highFidLocalAnswer);
        
        socket.emit("answer", { sdp: highFidLocalAnswer });
      } catch (err) {
        console.error("Error handling offer:", err);
      }
    });

    socket.on("answer", async (data) => {
      try {
        if (peerConnection) {
          // Modify remote description SDP to prefer high-fidelity audio
          const highFidRemoteAnswer = new RTCSessionDescription({
            type: data.sdp.type || "answer",
            sdp: preferHighFidelityAudio(data.sdp.sdp || data.sdp)
          });
          await peerConnection.setRemoteDescription(highFidRemoteAnswer);
          
          // Process any remote ICE candidates that arrived before the remote answer was set
          await processQueuedCandidates();
        }
      } catch (err) {
        console.error("Error handling answer:", err);
      }
    });

    socket.on("ice-candidate", async (data) => {
      try {
        if (data.candidate) {
          if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log("[WEBRTC] Successfully added remote ICE candidate");
          } else {
            console.log("[WEBRTC] Queueing remote ICE candidate until remote description is set");
            remoteCandidatesQueue.push(data.candidate);
          }
        }
      } catch (err) {
        console.error("Error handling ice candidate:", err);
      }
    });

    // Chat Message received
    socket.on("chat:receive", (data) => {
      appendChatMessage(data.email, data.text, data.timestamp);
    });

    // Typing Indicators
    socket.on("typing:start", (data) => {
      typingUsername.textContent = data.email;
      typingIndicator.classList.remove("hidden");
    });

    socket.on("typing:stop", () => {
      typingIndicator.classList.add("hidden");
    });

    // Screen Sharing notifications
    socket.on("share:start", (data) => {
      showToast(`${data.email} started screen sharing`, "info");
      updatePeerPresence("Sharing Screen");
      if (activeSharingMsg) activeSharingMsg.textContent = `${data.email} is sharing screen`;
      if (activeSharingBox) activeSharingBox.classList.remove("hidden");
    });

    socket.on("share:stop", (data) => {
      showToast(`${data.email} stopped screen sharing`, "warning");
      updatePeerPresence("Online");
      if (activeSharingBox) activeSharingBox.classList.add("hidden");
      // Reset view
      if (remoteVideo) remoteVideo.classList.add("hidden");
      if (videoPlaceholder) videoPlaceholder.classList.remove("hidden");
    });



    // Presence updates
    socket.on("user:online", (data) => {
      peerEmail = data.email;
      updatePeerPresence("Online");
      if (!peerConnection) {
        initPeerConnection();
      }
    });

    socket.on("user:offline", (data) => {
      if (peerEmail === data.email) {
        updatePeerPresence("Offline");
        closePeerConnection();
      }
    });

    socket.on("disconnect", () => {
      roomStatusBadge.textContent = "Disconnected";
      roomStatusBadge.className = "text-xs bg-rose-500/10 text-rose-400 px-2.5 py-1 rounded-full font-medium";
      webrtcStatusBadge.textContent = "P2P Off";
      webrtcStatusBadge.className = "text-xs bg-neutral-855 text-neutral-400 px-2.5 py-1 rounded-full font-medium";
      updatePeerPresence("Offline");
      closePeerConnection();
      socketCreated = false;
    });

    // Guest Events on Guest Client
    socket.on("host:accepted", (data) => {
      document.getElementById("guest-overlay").classList.add("hidden");
      currentUser.isGuestRequestPending = false;
      currentUser.email = data.email;
      navUsername.textContent = data.email;
      showToast("Access request accepted!", "success");
      
      setupEventListeners();
      socket.emit("user:online");
      updatePresence("Online");
    });

    socket.on("host:rejected", () => {
      showGuestStep("rejected");
    });

    socket.on("guest:request_error", (data) => {
      showToast(data.message, "error");
      showGuestStep("input");
    });

    // Guest Join Request on Host Client
    socket.on("guest:join_request", (data) => {
      currentGuestSocketId = data.guestSocketId;
      document.getElementById("request-guest-name").textContent = data.name;
      document.getElementById("host-request-modal").classList.remove("hidden");
    });
  }

  // WebRTC Peer Connection Core Logic
  function initPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(configuration);
    updateWebRTCBadge("Connecting");

    // ICE Candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", { candidate: event.candidate });
      }
    };

    // Connection state checks
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      updateWebRTCBadge(state);
      
      if (state === "connected") {
        showToast("WebRTC P2P connection established", "success");
      } else if (state === "failed" || state === "disconnected") {
        showToast("Unable to establish direct connection.", "error");
        updateWebRTCBadge("Failed");
      }
    };

    // Tracks incoming
    peerConnection.ontrack = (event) => {
      const track = event.track;
      console.log(`[WEBRTC] Incoming remote track: ${track.kind}, ID: ${track.id}`);
      
      if (track.kind === "video") {
        const streams = event.streams;
        if (streams && streams[0]) {
          remoteVideo.srcObject = streams[0];
          remoteVideo.muted = true; // Always mute the video tag to prevent double audio playback
          remoteVideo.classList.remove("hidden");
          videoPlaceholder.classList.add("hidden");
          remoteVideo.play().catch(e => console.error("Error playing video:", e));
        }
      } else if (track.kind === "audio") {
        // Spawn a dedicated, dynamic audio element for this specific track to avoid stream-overwriting conflicts
        if (!remoteAudioElements.has(track.id)) {
          console.log(`[WEBRTC] Spawning dynamic audio element for audio track ID: ${track.id}`);
          const aud = document.createElement("audio");
          aud.autoplay = true;
          aud.muted = isMutedRemoteAudio;
          
          const newStream = new MediaStream([track]);
          aud.srcObject = newStream;
          document.body.appendChild(aud);
          
          remoteAudioElements.set(track.id, aud);
          
          aud.play().catch(e => console.warn(`[WEBRTC] Error playing dynamic audio track ${track.id}:`, e));
        }
      }
    };



    // If we have active screen share stream, attach it
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(track => {
        const sender = peerConnection.addTrack(track, localScreenStream);
        screenSenders.push(sender);
      });
    }
  }

  function closePeerConnection() {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    micSender = null;
    screenSenders = [];
    remoteVideo.srcObject = null;
    remoteCandidatesQueue.length = 0; // Clear the ICE candidate queue
    
    // Clean up all dynamically created remote audio elements from DOM and clear map
    for (const [trackId, aud] of remoteAudioElements.entries()) {
      try {
        console.log(`[WEBRTC] Cleaning up dynamic audio element for track ID: ${trackId}`);
        aud.pause();
        aud.srcObject = null;
        aud.remove();
      } catch (e) {
        console.error(`Error cleaning up audio element for track ${trackId}:`, e);
      }
    }
    remoteAudioElements.clear();
    
    remoteVideo.classList.add("hidden");
    videoPlaceholder.classList.remove("hidden");
    placeholderStatus.textContent = "Waiting for connection to establish...";
    updateWebRTCBadge("Disconnected");
  }

  // Helper to rewrite SDP parameters to enforce lossless/high-fidelity stereo audio specifically for Opus
  function preferHighFidelityAudio(sdp) {
    let lines = sdp.split("\r\n");
    let opusPayloadType = null;
    
    // Find the dynamic payload type number for the Opus codec
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("a=rtpmap:") && lines[i].toLowerCase().includes("opus/48000/2")) {
        const match = lines[i].match(/a=rtpmap:(\d+)\s+opus/i);
        if (match) {
          opusPayloadType = match[1];
          break;
        }
      }
    }
    
    if (!opusPayloadType) {
      console.warn("[WEBRTC] Opus payload type not detected in SDP");
      return sdp;
    }
    
    // Apply stereo and high bitrate options only to the Opus fmtp line to avoid corrupting video track formats
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`a=fmtp:${opusPayloadType}`)) {
        if (!lines[i].includes("stereo=1")) {
          lines[i] = lines[i] + ";stereo=1;sprop-stereo=1;maxaveragebitrate=510000;useinbandfec=1;maxplaybackrate=48000";
          console.log("[WEBRTC] Successfully modified Opus SDP settings to high-fidelity stereo");
        }
      }
    }
    return lines.join("\r\n");
  }

  // Helper to process queued remote ICE candidates after remoteDescription has been successfully set
  async function processQueuedCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    console.log(`[WEBRTC] Processing ${remoteCandidatesQueue.length} queued remote ICE candidates`);
    while (remoteCandidatesQueue.length > 0) {
      const candidate = remoteCandidatesQueue.shift();
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("[WEBRTC] Successfully added queued remote ICE candidate");
      } catch (e) {
        console.error("[WEBRTC] Error adding queued ICE candidate:", e);
      }
    }
  }

  // Trigger renegotiation on track changes
  async function negotiate() {
    if (!peerConnection) return;
    try {
      const offer = await peerConnection.createOffer();
      const highFidOffer = new RTCSessionDescription({
        type: offer.type,
        sdp: preferHighFidelityAudio(offer.sdp)
      });
      await peerConnection.setLocalDescription(highFidOffer);
      socket.emit("offer", { sdp: highFidOffer });
    } catch (err) {
      console.error("Error during negotiation offer creation:", err);
    }
  }

  // Presence badges
  function updatePresence(state) {
    // Current user presence (could be emitted to server if we want, but local presence is updated)
    // States: Online, Offline, Sharing Screen, Talking, Idle
    if (socket) {
      if (state === "Sharing Screen") {
        socket.emit("share:start");
      } else if (state === "Online") {
        // If we transition out of sharing/talking
        if (localScreenStream) {
          socket.emit("share:start");
        } else {
          socket.emit("user:online");
        }
      }
    }
  }

  function updatePeerPresence(state) {
    peerPresenceState = state;
    if (peerUsernameDisplay) {
      peerUsernameDisplay.textContent = peerEmail ? `${peerEmail.split('@')[0]} (${state})` : "No Peer";
    }
    
    // Status color configurations
    let dotClass = "inline-block h-1.5 w-1.5 rounded-full ";
    switch (state) {
      case "Online":
        dotClass += "bg-emerald-500 animate-pulse";
        break;
      case "Sharing Screen":
        dotClass += "bg-amber-500 animate-pulse";
        break;
      case "Talking":
        dotClass += "bg-sky-500 animate-pulse";
        break;
      case "Idle":
        dotClass += "bg-neutral-500";
        break;
      case "Offline":
      default:
        dotClass += "bg-neutral-700";
        if (peerUsernameDisplay) peerUsernameDisplay.textContent = "No Peer";
        break;
    }
    if (peerPresenceDot) {
      peerPresenceDot.className = dotClass;
    }
  }

  function updateWebRTCBadge(state) {
    let displayState = state.charAt(0).toUpperCase() + state.slice(1);
    if (state === "connected") displayState = "P2P On";
    if (state === "disconnected" || state === "failed") displayState = "P2P Off";
    
    if (webrtcStatusBadge) {
      webrtcStatusBadge.textContent = displayState;
      
      let badgeClass = "text-xs px-2.5 py-1 rounded-full font-medium ";
      if (state === "connected") {
        badgeClass += "bg-emerald-500/10 text-emerald-400";
      } else if (state === "connecting" || state === "checking") {
        badgeClass += "bg-amber-500/10 text-amber-400";
      } else if (state === "failed" || state === "disconnected") {
        badgeClass += "bg-rose-500/10 text-rose-400";
      } else {
        badgeClass += "bg-neutral-850 text-neutral-400";
      }
      
      webrtcStatusBadge.className = badgeClass;
    }
  }

  // Event Listeners setup
  function setupEventListeners() {
    // Logout
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await cleanupStreams();
        try {
          const response = await fetch("/api/auth/logout", { method: "POST" });
          if (response.ok) window.location.href = "/login.html";
        } catch (err) {
          window.location.href = "/login.html";
        }
      });
    }

    // Screen Share Button
    if (shareScreenBtn) shareScreenBtn.addEventListener("click", startScreenShare);
    if (stopShareBtn) stopShareBtn.addEventListener("click", stopScreenShare);
    
    // Share Link Button
    if (shareLinkBtn) {
      shareLinkBtn.addEventListener("click", generateInviteLink);
    }

    // Mute Remote Audio
    if (muteAudioBtn) {
      muteAudioBtn.addEventListener("click", () => {
        isMutedRemoteAudio = !isMutedRemoteAudio;
        // Mute all active dynamic remote audio elements
        for (const aud of remoteAudioElements.values()) {
          aud.muted = isMutedRemoteAudio;
        }
        
        const audioIconUnmuted = document.getElementById("audio-icon-unmuted");
        const audioIconMuted = document.getElementById("audio-icon-muted");

        if (isMutedRemoteAudio) {
          if (audioIconUnmuted) audioIconUnmuted.classList.add("hidden");
          if (audioIconMuted) audioIconMuted.classList.remove("hidden");
          muteAudioBtn.classList.remove("bg-neutral-800", "text-neutral-300");
          muteAudioBtn.classList.add("bg-rose-500/20", "text-rose-500", "border", "border-rose-500/30");
          showToast("Theater muted", "warning");
        } else {
          if (audioIconUnmuted) audioIconUnmuted.classList.remove("hidden");
          if (audioIconMuted) audioIconMuted.classList.add("hidden");
          muteAudioBtn.classList.add("bg-neutral-800", "text-neutral-300");
          muteAudioBtn.classList.remove("bg-rose-500/20", "text-rose-500", "border", "border-rose-500/30");
          showToast("Theater unmuted", "info");
        }
      });
    }

    // Picture in picture (PiP)
    if (pipBtn) {
      pipBtn.addEventListener("click", async () => {
        try {
          if (remoteVideo && !remoteVideo.paused && remoteVideo.srcObject) {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
            } else if (remoteVideo.requestPictureInPicture) {
              await remoteVideo.requestPictureInPicture();
            }
          } else {
            showToast("No active video feed to run Picture-in-Picture", "warning");
          }
        } catch (err) {
          console.error(err);
        }
      });
    }

    // Fullscreen
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener("click", () => {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else if (videoContainer) {
          videoContainer.requestFullscreen().catch(e => {
            showToast("Fullscreen request blocked", "error");
          });
        }
      });
    }

    // Destroy Room (host only)
    if (destroyRoomBtn) {
      destroyRoomBtn.addEventListener("click", () => {
        if (socket && currentUser && currentUser.role === "admin") {
          if (confirm("Are you sure you want to destroy the room? All peers will be disconnected.")) {
            socket.emit("room:destroy");
          }
        }
      });
    }



    // Ephemeral Chat form
    if (chatForm) {
      chatForm.addEventListener("submit", sendChatMessage);
    }
    
    // Chat Enter to submit, Shift+Enter for new line
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage(e);
        }
      });

      // Chat typing listeners
      chatInput.addEventListener("input", handleChatTyping);
    }

    // Window before unload
    window.addEventListener("beforeunload", () => {
      if (socket) {
        try {
          socket.emit("user:offline");
          socket.disconnect();
        } catch (e) {
          console.error(e);
        }
      }
      cleanupStreams();
    });

    // Idle presence handler (if user does not move mouse or press keys for 5 mins, mark as Idle)
    resetIdleTimer();
    window.addEventListener("mousemove", resetIdleTimer);
    window.addEventListener("keypress", resetIdleTimer);
  }

  // Screen Sharing functions
  async function startScreenShare() {
    try {
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false
        }
      });

      // Render shared stream inside the main full-screen player area
      if (remoteVideo) {
        remoteVideo.srcObject = localScreenStream;
        remoteVideo.muted = true; // Avoid local system/mic audio feedback loop
        remoteVideo.classList.remove("hidden");
      }
      if (videoPlaceholder) {
        videoPlaceholder.classList.add("hidden");
      }
      
      // Hide preview thumbnail since it plays on the main player area
      if (localVideo) localVideo.srcObject = null;
      if (localPreviewContainer) localPreviewContainer.classList.add("hidden");
      
      // Update UI buttons
      if (shareScreenBtn) shareScreenBtn.classList.add("hidden");
      if (stopShareBtn) stopShareBtn.classList.remove("hidden");
      
      const meetStatus = document.getElementById("meet-status-text");
      if (meetStatus) meetStatus.textContent = "Sharing screen";

      showToast("Started screen sharing", "success");
      updatePresence("Sharing Screen");

      // Attach tracks to WebRTC
      if (peerConnection) {
        localScreenStream.getTracks().forEach(track => {
          const sender = peerConnection.addTrack(track, localScreenStream);
          screenSenders.push(sender);
        });
        // renegotiate
        await negotiate();
      }

      // Detect user clicking "Stop Sharing" from browser toolbar natively
      localScreenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.warn("Screen share cancelled/failed:", err);
      showToast("Screen share cancelled", "warning");
    }
  }

  async function stopScreenShare() {
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(track => track.stop());
      localScreenStream = null;
    }

    if (remoteVideo) {
      remoteVideo.srcObject = null;
      remoteVideo.muted = isMutedRemoteAudio; // Restore client mute setting
      remoteVideo.classList.add("hidden");
    }
    if (videoPlaceholder) {
      videoPlaceholder.classList.remove("hidden");
    }

    if (shareScreenBtn) shareScreenBtn.classList.remove("hidden");
    if (stopShareBtn) stopShareBtn.classList.add("hidden");

    const meetStatus = document.getElementById("meet-status-text");
    if (meetStatus) meetStatus.textContent = "P2P Theater active";

    showToast("Stopped screen sharing", "warning");
    
    // Tell socket signaling
    if (socket) {
      socket.emit("share:stop");
    }
    updatePresence("Online");

    // Remove tracks from WebRTC peer connection
    if (peerConnection && screenSenders.length > 0) {
      screenSenders.forEach(sender => {
        try {
          peerConnection.removeTrack(sender);
        } catch (e) {
          console.error(e);
        }
      });
      screenSenders = [];
      await negotiate();
    }
  }



  // Ephemeral Chat messages
  function sendChatMessage(e) {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Display locally
    appendChatMessage("You", text, timestamp);
    
    // Broadcast via socket
    if (socket) {
      socket.emit("chat:send", { text });
      socket.emit("typing:stop");
    }

    chatInput.value = "";
    isTyping = false;
  }

  function appendChatMessage(sender, text, timestamp) {
    const isSelf = sender === "You";
    const initial = sender.charAt(0).toUpperCase();
    
    // Set matching colors for the user avatars
    const avatarBg = isSelf ? "bg-rose-500 text-white" : "bg-sky-500 text-neutral-950";
    
    const msgDiv = document.createElement("div");
    msgDiv.className = "flex items-start space-x-3 py-3 border-b border-neutral-800/40 last:border-0";
    
    msgDiv.innerHTML = `
      <div class="h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${avatarBg} select-none">
        ${initial}
      </div>
      <div class="flex-grow min-w-0">
        <div class="flex items-baseline justify-between mb-1 select-none">
          <span class="font-semibold text-xs ${isSelf ? 'text-rose-400' : 'text-sky-400'}">${escapeHTML(sender)}</span>
          <span class="text-[10px] text-neutral-500">${timestamp}</span>
        </div>
        <p class="text-sm select-text text-neutral-200 leading-relaxed">${escapeHTML(text).replace(/\n/g, "<br>")}</p>
      </div>
    `;

    chatMessages.appendChild(msgDiv);
    
    // Auto Scroll to bottom (support delayed scroll for layout calculations)
    chatMessages.scrollTop = chatMessages.scrollHeight;
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 50);
  }

  function handleChatTyping() {
    if (!isTyping && socket) {
      isTyping = true;
      socket.emit("typing:start");
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      if (isTyping && socket) {
        isTyping = false;
        socket.emit("typing:stop");
      }
    }, 2000);
  }

  // Toast System
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    // Styling categories
    let borderBgClass = "";
    switch (type) {
      case "success":
        borderBgClass = "bg-emerald-950/90 border border-emerald-500/30 text-emerald-400";
        break;
      case "warning":
        borderBgClass = "bg-amber-950/90 border border-amber-500/30 text-amber-400";
        break;
      case "error":
        borderBgClass = "bg-rose-950/90 border border-rose-500/30 text-rose-400";
        break;
      case "info":
      default:
        borderBgClass = "bg-neutral-900/90 border border-neutral-700/60 text-neutral-200";
        break;
    }

    toast.className = `p-4 rounded-2xl shadow-xl backdrop-blur-md transition-all duration-300 pointer-events-auto flex items-center justify-between space-x-3 translate-y-4 opacity-0 ${borderBgClass}`;
    toast.innerHTML = `
      <span class="text-xs font-semibold leading-relaxed">${escapeHTML(message)}</span>
      <button class="text-neutral-500 hover:text-neutral-300 text-xs focus:outline-none select-none">✕</button>
    `;

    toastContainer.appendChild(toast);

    // Animate in
    setTimeout(() => {
      toast.classList.remove("translate-y-4", "opacity-0");
    }, 10);

    // Dismiss click
    toast.querySelector("button").addEventListener("click", () => {
      dismissToast(toast);
    });

    // Self destroy after 4s
    setTimeout(() => {
      dismissToast(toast);
    }, 4000);
  }

  function dismissToast(toast) {
    if (toast.parentNode) {
      toast.classList.add("opacity-0", "translate-y-2");
      setTimeout(() => {
        if (toast.parentNode) {
          toastContainer.removeChild(toast);
        }
      }, 300);
    }
  }

  // Idle timer logic
  function resetIdleTimer() {
    if (peerPresenceState === "Idle") {
      updatePresence("Online");
    }
    
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      if (socket && !localScreenStream) {
        socket.emit("user:offline"); // signals idle state
        updatePeerPresence("Idle"); // Local update
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  // Cleanup helper
  async function cleanupStreams() {
    await stopScreenShare();
  }

  // Generate Invite Link and Copy to Clipboard
  async function generateInviteLink() {
    shareLinkBtn.disabled = true;
    shareLinkBtn.classList.add("opacity-50");

    try {
      const response = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) throw new Error("Failed to create invite link");
      const data = await response.json();

      await navigator.clipboard.writeText(data.inviteLink);
      showToast("Invite link copied to clipboard!", "success");
    } catch (err) {
      console.error(err);
      showToast("Could not generate invite link", "error");
    } finally {
      shareLinkBtn.disabled = false;
      shareLinkBtn.classList.remove("opacity-50");
    }
  }

  // Escape HTML utility
  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
  }

  // Guest UI State Control
  function showGuestStep(step) {
    document.getElementById("guest-step-input").classList.add("hidden");
    document.getElementById("guest-step-waiting").classList.add("hidden");
    document.getElementById("guest-step-rejected").classList.add("hidden");

    if (step === "input") {
      document.getElementById("guest-step-input").classList.remove("hidden");
    } else if (step === "waiting") {
      document.getElementById("guest-step-waiting").classList.remove("hidden");
    } else if (step === "rejected") {
      document.getElementById("guest-step-rejected").classList.remove("hidden");
    }
  }

  // Bind Guest overlay events
  const guestJoinForm = document.getElementById("guest-join-form");
  const guestNameInput = document.getElementById("guest-name-input");
  const guestRetryBtn = document.getElementById("guest-retry-btn");

  if (guestJoinForm) {
    guestJoinForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = guestNameInput.value.trim();
      if (!name) return;

      showGuestStep("waiting");
      if (socket) {
        socket.emit("guest:request_join", { name });
      }
    });
  }

  if (guestRetryBtn) {
    guestRetryBtn.addEventListener("click", () => {
      showGuestStep("input");
    });
  }

  // Host Approval Modal Event Handlers
  const hostRequestModal = document.getElementById("host-request-modal");
  const hostAcceptBtn = document.getElementById("host-accept-btn");
  const hostRejectBtn = document.getElementById("host-reject-btn");
  let currentGuestSocketId = null;

  if (hostAcceptBtn && hostRejectBtn) {
    hostAcceptBtn.addEventListener("click", () => {
      if (socket && currentGuestSocketId) {
        socket.emit("host:accept_guest", { guestSocketId: currentGuestSocketId });
      }
      hostRequestModal.classList.add("hidden");
      currentGuestSocketId = null;
    });

    hostRejectBtn.addEventListener("click", () => {
      if (socket && currentGuestSocketId) {
        socket.emit("host:reject_guest", { guestSocketId: currentGuestSocketId });
      }
      hostRequestModal.classList.add("hidden");
      currentGuestSocketId = null;
    });
  }
});

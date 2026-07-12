(() => {
// App initialization starts immediately on script evaluation
  const roomStatusBadge = document.getElementById("room-status-badge");
  const webrtcStatusBadge = document.getElementById("webrtc-status-badge");
  const partyRoomTitle = document.getElementById("party-room-title");
  
  const videoElement = document.getElementById("theater-video");
  const videoPlaceholder = document.getElementById("video-placeholder");
  const placeholderStatus = document.getElementById("placeholder-status");

  const qualitySelect = document.getElementById("quality-select");
  const hostStartBtn = document.getElementById("host-start-share-btn");
  const hostStopBtn = document.getElementById("host-stop-share-btn");
  const shareLinkBtn = document.getElementById("share-link-btn");
  const muteBtn = document.getElementById("theater-mute-btn");
  const volumeUpIcon = document.getElementById("volume-up-icon");
  const volumeMuteIcon = document.getElementById("volume-mute-icon");
  const fullscreenBtn = document.getElementById("theater-fullscreen-btn");
  const activeViewerCount = document.getElementById("active-viewer-count");

  const membersList = document.getElementById("members-list");
  const chatMessages = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");

  const guestOverlay = document.getElementById("guest-overlay");
  const guestLoginForm = document.getElementById("guest-login-form");
  const guestNameInput = document.getElementById("guest-name");

  // State Variables
  const params = new URLSearchParams(window.location.search);
  const partyId = params.get("party");

  if (!partyId) {
    window.location.href = "/lobby.html";
    return;
  }

  let socket = null;
  let currentUser = null;
  let partyDetails = null;
  
  let localStream = null; // Host screen stream
  let whipPeerConnection = null; // Host WHIP WebRTC connection
  let hlsPlayer = null; // Viewer HLS player instance

  let isMuted = false;
  let connectionPollingInterval = null;

  // 1. Initial Authentication & Verification Flow
  async function initializeTheater() {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        // Show Anonymous Guest Name Prompt if not logged in
        guestOverlay.classList.remove("hidden");
        return;
      }
      
      const authData = await res.json();
      currentUser = authData.user;
      
      // Verify party existence and check room capacity (capping at 4 viewers)
      const partyRes = await fetch(`/api/parties/${partyId}`);
      if (!partyRes.ok) {
        const errorData = await partyRes.json();
        alert(errorData.error || "Room capacity validation failed.");
        window.location.href = "/lobby.html";
        return;
      }

      const partyData = await partyRes.json();
      partyDetails = partyData.party;

      // Update room header details
      partyRoomTitle.textContent = partyDetails.title;

      // Render Host-specific controls
      if (partyDetails.isHost) {
        hostStartBtn.classList.remove("hidden");
        qualitySelect.classList.remove("hidden");
      } else {
        // Viewers don't select quality directly because HLS matches host constraints
        qualitySelect.innerHTML = `<option value="auto">Stream Quality (Auto)</option>`;
      }

      // Initialize Socket connection
      setupWebSocket();

      // Viewers: Start attempting HLS playback
      if (!partyDetails.isHost) {
        startHlsPlayback();
      }

    } catch (err) {
      console.error("[THEATER] Initialization error:", err);
      alert("An error occurred during theater setup.");
      window.location.href = "/lobby.html";
    }
  }

  // 2. Anonymous Guest Login Form handler
  guestLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = guestNameInput.value.trim();
    if (!name) return;

    try {
      const res = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, partyId })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Guest join failed.");
      }

      guestOverlay.classList.add("hidden");
      initializeTheater(); // Retry normal initialization
    } catch (err) {
      alert(err.message);
    }
  });

  // 3. Socket.IO setups
  function setupWebSocket() {
    socket = io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ["polling", "websocket"]
    });

    socket.on("connect", () => {
      console.log("[SOCKET] Websocket connected. Joining watch party...");
      socket.emit("join-party", { partyId });
    });

    socket.on("user-joined", (data) => {
      showToast(`${data.email} joined the theater`, "success");
      activeViewerCount.textContent = `${data.count} participant${data.count > 1 ? "s" : ""}`;
    });

    socket.on("user-left", (data) => {
      showToast(`${data.email} left the theater`, "warning");
      activeViewerCount.textContent = `${data.count} participant${data.count > 1 ? "s" : ""}`;
      
      // Update participants list
      removeMemberFromUI(data.userId);
    });

    socket.on("room-members", (list) => {
      renderMembersList(list);
      const count = list.length;
      activeViewerCount.textContent = `${count} participant${count > 1 ? "s" : ""}`;
    });

    socket.on("chat-message", (data) => {
      appendChatMessage(data.email, data.text, data.timestamp);
    });

    socket.on("room-full", (data) => {
      alert(data.message);
      window.location.href = "/lobby.html";
    });

    socket.on("error", (data) => {
      console.error("[SOCKET] Socket error:", data);
      showToast(data.message, "error");
    });

    socket.on("disconnect", () => {
      console.warn("[SOCKET] Websocket disconnected.");
      roomStatusBadge.textContent = "Connecting";
      roomStatusBadge.className = "text-xs bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full font-medium";
    });

    // Notify connected status once user actually joins room
    socket.on("user-joined", (data) => {
      if (data.userId == currentUser.id) {
        roomStatusBadge.textContent = "Connected";
        roomStatusBadge.className = "text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full font-medium";
      }
    });
  }

  // Helper: Gather all ICE candidates locally before sending offer (fixes WHIP negotiation delays)
  async function gatherIceCandidates(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
      } else {
        function checkState() {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        }
        pc.addEventListener("icegatheringstatechange", checkState);
      }
    });
  }

  // 4. Host: Start WHIP Streaming directly from Chrome screen capture
  async function startWhipIngest() {
    try {
      const selectedQuality = qualitySelect.value;
      const width = selectedQuality === "720p" ? 1280 : 1920;
      const height = selectedQuality === "720p" ? 720 : 1080;

      showToast("Requesting screen capture permission...", "info");
      
      // Capture Chrome screen stream
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false
        }
      });

      // Show mirror on Host screen
      videoElement.srcObject = localStream;
      videoElement.muted = true; // Avoid feedback loop
      videoElement.classList.remove("hidden");
      videoPlaceholder.classList.add("hidden");

      // Initialize WebRTC WHIP Peer Connection
      whipPeerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });

      // Bind track listeners to show mirror
      localStream.getTracks().forEach(track => {
        if (track.kind === "video") {
          track.contentHint = "motion"; // Optimize screen updates specifically for videos/movies
        }
        whipPeerConnection.addTrack(track, localStream);
      });

      // Host: Create SDP offer
      const offer = await whipPeerConnection.createOffer();
      await whipPeerConnection.setLocalDescription(offer);

      // Wait for candidate gathering
      placeholderStatus.textContent = "Negotiating connection with streaming server...";
      await gatherIceCandidates(whipPeerConnection);

      // Perform WHIP POST ingestion handshake to MediaMTX
      const whipResponse = await fetch(partyDetails.whipUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: whipPeerConnection.localDescription.sdp
      });

      if (!whipResponse.ok) {
        throw new Error("Streaming server WHIP handshake rejected.");
      }

      // Read remote description SDP answer from MediaMTX
      const answerSdp = await whipResponse.text();
      await whipPeerConnection.setRemoteDescription(new RTCSessionDescription({
        type: "answer",
        sdp: answerSdp
      }));

      showToast("Screen streaming published successfully!", "success");
      
      // Toggle button states
      hostStartBtn.classList.add("hidden");
      qualitySelect.classList.add("hidden");
      hostStopBtn.classList.remove("hidden");

      // Listen for stream stop from browser toolbar natively
      localStream.getVideoTracks()[0].onended = () => {
        stopWhipIngest();
      };

    } catch (err) {
      console.error("[WHIP] Ingest error:", err);
      showToast(err.message || "Screen share cancelled or failed.", "error");
      cleanupWhip();
    }
  }

  // Host: Stop Streaming & Cleanup
  async function stopWhipIngest() {
    cleanupWhip();
    showToast("Screen sharing stopped.", "warning");
    hostStopBtn.classList.add("hidden");
    hostStartBtn.classList.remove("hidden");
    qualitySelect.classList.remove("hidden");
  }

  function cleanupWhip() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    if (whipPeerConnection) {
      whipPeerConnection.close();
      whipPeerConnection = null;
    }
    videoElement.srcObject = null;
    videoElement.classList.add("hidden");
    videoPlaceholder.classList.remove("hidden");
    placeholderStatus.textContent = "Waiting for the host to start sharing their screen...";
  }

  // 5. Viewers: Low-Latency HLS Playback using hls.js
  function startHlsPlayback() {
    if (hlsPlayer) {
      hlsPlayer.destroy();
      hlsPlayer = null;
    }

    const streamSrc = partyDetails.hlsUrl;
    const fullHlsUrl = window.location.origin + streamSrc;
    console.log(`[HLS] Playback URL: ${fullHlsUrl}`);

    if (Hls.isSupported()) {
      hlsPlayer = new Hls({
        lowLatencyMode: true, // Enables low-latency buffering (2-4s)
        backBufferLength: 5,
        manifestLoadingMaxRetry: Infinity,
        manifestLoadingRetryDelay: 2000
      });

      hlsPlayer.loadSource(streamSrc);
      hlsPlayer.attachMedia(videoElement);

      hlsPlayer.on(Hls.Events.MANIFEST_LOADED, () => {
        console.log("[HLS] Stream source is online!");
        videoPlaceholder.classList.add("hidden");
        videoElement.classList.remove("hidden");
        videoElement.play().catch(e => console.warn("Autoplay blocked:", e));
      });

      // Handle manifest loading errors (e.g. host hasn't started streaming yet)
      hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
          videoElement.classList.add("hidden");
          videoPlaceholder.classList.remove("hidden");
          placeholderStatus.textContent = "Theater is offline. Waiting for stream to go live...";
        }
      });

    } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari)
      videoElement.src = streamSrc;
      videoElement.addEventListener("loadedmetadata", () => {
        videoPlaceholder.classList.add("hidden");
        videoElement.classList.remove("hidden");
        videoElement.play();
      });
    }
  }

  // 6. Action Button Event Listeners
  if (hostStartBtn) hostStartBtn.addEventListener("click", startWhipIngest);
  if (hostStopBtn) hostStopBtn.addEventListener("click", stopWhipIngest);

  // Copy Invite Link
  shareLinkBtn.addEventListener("click", () => {
    // Generate anonymous invite link incorporating the party ID
    const inviteLink = `${window.location.origin}/app.html?party=${partyDetails.id}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      showToast("Invite link copied to clipboard!", "success");
    }).catch(err => {
      console.error("Failed to copy link:", err);
    });
  });

  // Mute/Unmute Audio
  muteBtn.addEventListener("click", () => {
    isMuted = !isMuted;
    videoElement.muted = isMuted;

    if (isMuted) {
      volumeUpIcon.classList.add("hidden");
      volumeMuteIcon.classList.remove("hidden");
      showToast("Theater audio muted", "warning");
    } else {
      volumeMuteIcon.classList.add("hidden");
      volumeUpIcon.classList.remove("hidden");
      showToast("Theater audio unmuted", "success");
    }
  });

  // Fullscreen toggle
  fullscreenBtn.addEventListener("click", () => {
    const container = document.getElementById("video-container");
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => {
        showToast("Fullscreen request blocked.", "error");
      });
    } else {
      document.exitFullscreen();
    }
  });

  // 7. Live Ephemeral Chat Submission
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !socket) return;

    socket.emit("chat-message", { text });
    chatInput.value = "";
  });

  // Enter triggers chat submit, Shift+Enter yields new line
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit"));
    }
  });

  // 8. UI Rendering Helper Functions
  function renderMembersList(list) {
    membersList.innerHTML = list.map(member => `
      <span class="inline-flex items-center rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-300 border border-neutral-700/60 select-none">
        <span class="mr-1.5 h-1.5 w-1.5 rounded-full ${member.isHost ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}"></span>
        ${escapeHtml(member.email.split("@")[0])} ${member.isHost ? '(Host)' : ''}
      </span>
    `).join("");
  }

  function removeMemberFromUI(userId) {
    // Re-request members list via socket or allow Socket.IO status updates to repaint
  }

  function appendChatMessage(sender, text, timestamp) {
    const cleanSender = sender.split("@")[0];
    const isMe = sender === currentUser.email;

    const msgHtml = `
      <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'}">
        <div class="flex items-baseline space-x-2">
          <span class="text-xs font-bold text-neutral-400">${escapeHtml(cleanSender)}</span>
          <span class="text-[9px] text-neutral-600">${timestamp}</span>
        </div>
        <div class="mt-1 max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-normal text-white ${
          isMe 
            ? 'bg-gradient-to-r from-rose-500 to-rose-600 rounded-tr-none' 
            : 'bg-neutral-900 border border-neutral-800 rounded-tl-none'
        }">
          ${escapeHtml(text)}
        </div>
      </div>
    `;

    chatMessages.insertAdjacentHTML("beforeend", msgHtml);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
  }

  // Reusable dynamic toast message alert
  function showToast(msg, type = "info") {
    const toast = document.createElement("div");
    toast.className = `fixed bottom-4 left-4 z-50 rounded-2xl border px-4 py-3 text-xs font-bold shadow-xl transition transform translate-y-2 opacity-0 duration-300 `;
    
    if (type === "success") {
      toast.className += "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    } else if (type === "warning") {
      toast.className += "bg-amber-500/10 text-amber-400 border-amber-500/20";
    } else if (type === "error") {
      toast.className += "bg-rose-500/10 text-rose-400 border-rose-500/20";
    } else {
      toast.className += "bg-neutral-900 border-neutral-800 text-neutral-300";
    }

    toast.textContent = msg;
    document.body.appendChild(toast);

    // Fade-in animation
    setTimeout(() => {
      toast.classList.remove("translate-y-2", "opacity-0");
    }, 10);

    // Auto cleanup
    setTimeout(() => {
      toast.classList.add("translate-y-2", "opacity-0");
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // Trigger initial checks
  initializeTheater();
})();

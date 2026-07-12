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
  const videoContainer = document.getElementById("video-container");
  const volumeUpIcon = document.getElementById("volume-up-icon");
  const volumeMuteIcon = document.getElementById("volume-mute-icon");
  const fullscreenBtn = document.getElementById("theater-fullscreen-btn");
  const mobileFullscreenBtn = document.getElementById("mobile-fullscreen-btn");
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
  let hlsRestartTimer = null;
  let viewerRecoveryTimer = null;
  let lastPlaybackNudge = 0;
  let viewerRecoveryHandlersAttached = false;
  let nativeHlsMetadataHandlerAttached = false;
  let needsAudioUnlock = false;
  let socketSetupStarted = false;
  let joinedCurrentSocket = false;
  const renderedChatMessageIds = new Set();

  const QUALITY_PROFILES = {
    "1080p": { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_000_000 },
    "720p": { width: 1280, height: 720, frameRate: 30, maxBitrate: 2_200_000 },
    "480p": { width: 854, height: 480, frameRate: 24, maxBitrate: 1_000_000 },
    auto: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_800_000 }
  };

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
    if (socketSetupStarted) return;
    socketSetupStarted = true;

    socket = io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ["polling", "websocket"]
    });

    socket.on("connect", () => {
      console.log("[SOCKET] Websocket connected. Joining watch party...");
      joinedCurrentSocket = false;
      socket.emit("join-party", { partyId });
    });

    socket.on("user-joined", (data) => {
      if (data.userId == currentUser.id) {
        joinedCurrentSocket = true;
        roomStatusBadge.textContent = "Connected";
        roomStatusBadge.className = "text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full font-medium";
      }

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
      appendChatMessage(data);
    });

    socket.on("stream-started", () => {
      if (!partyDetails.isHost) {
        showToast("The movie stream is live.", "success");
        restartHlsPlayback(700);
      }
    });

    socket.on("stream-stopped", () => {
      if (!partyDetails.isHost) {
        stopHlsPlayback();
        videoElement.classList.add("hidden");
        videoPlaceholder.classList.remove("hidden");
        placeholderStatus.textContent = "The host stopped sharing. Waiting for the next stream...";
      }
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
      joinedCurrentSocket = false;
      roomStatusBadge.textContent = "Connecting";
      roomStatusBadge.className = "text-xs bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full font-medium";
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
      const profile = QUALITY_PROFILES[selectedQuality] || QUALITY_PROFILES.auto;

      showToast("Requesting screen capture permission...", "info");
      
      // Capture Chrome screen stream
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: profile.width },
          height: { ideal: profile.height },
          frameRate: { ideal: profile.frameRate, max: profile.frameRate }
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

      whipPeerConnection.onconnectionstatechange = () => {
        console.log(`[WEBRTC] Connection state: ${whipPeerConnection.connectionState}`);
      };
      whipPeerConnection.oniceconnectionstatechange = () => {
        console.log(`[WEBRTC] ICE connection state: ${whipPeerConnection.iceConnectionState}`);
      };

      // Bind track listeners to show mirror
      localStream.getTracks().forEach(track => {
        if (track.kind === "video") {
          track.contentHint = "motion"; // Optimize screen updates specifically for videos/movies
        } else if (track.kind === "audio") {
          track.contentHint = "music";
        }
        whipPeerConnection.addTrack(track, localStream);
      });

      if (!localStream.getAudioTracks().length) {
        showToast("No screen audio was shared. Select a tab/window with audio enabled.", "warning");
      }

      // Force H.264 video codec preference to ensure HLS compatibility
      const videoTransceiver = whipPeerConnection.getTransceivers().find(t => 
        (t.receiver.track && t.receiver.track.kind === "video") || 
        (t.sender.track && t.sender.track.kind === "video")
      );
      if (videoTransceiver && typeof RTCRtpReceiver.getCapabilities === "function") {
        try {
          const capabilities = RTCRtpReceiver.getCapabilities("video");
          if (capabilities && capabilities.codecs) {
            const h264Codecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === "video/h264");
            const otherCodecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() !== "video/h264");
            const sortedCodecs = [...h264Codecs, ...otherCodecs];
            videoTransceiver.setCodecPreferences(sortedCodecs);
            console.log("[WEBRTC] Prioritized H.264 video codec successfully.");
          }
        } catch (err) {
          console.warn("[WEBRTC] Failed to set H.264 codec preference:", err);
        }
      }

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

      await tuneSenderBitrates(profile);

      showToast("Screen streaming published successfully!", "success");
      if (socket && socket.connected) {
        socket.emit("stream-started", { quality: selectedQuality });
      }
      
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
    if (socket && socket.connected) {
      socket.emit("stream-stopped");
    }
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

  async function tuneSenderBitrates(profile) {
    if (!whipPeerConnection) return;

    const senders = whipPeerConnection.getSenders();
    await Promise.all(senders.map(async (sender) => {
      if (!sender.track) return;

      const params = sender.getParameters();
      params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];

      if (sender.track.kind === "video") {
        params.encodings[0].maxBitrate = profile.maxBitrate;
        params.encodings[0].maxFramerate = profile.frameRate;
        params.degradationPreference = "maintain-framerate";
      }

      if (sender.track.kind === "audio") {
        params.encodings[0].maxBitrate = 128_000;
      }

      try {
        await sender.setParameters(params);
      } catch (err) {
        console.warn("[WEBRTC] Could not tune sender bitrate:", err);
      }
    }));
  }

  // 5. Viewers: Low-Latency HLS Playback using hls.js
  function startHlsPlayback() {
    stopHlsPlayback();
    videoElement.muted = isMuted;
    videoElement.volume = isMuted ? 0 : 1;

    const streamSrc = partyDetails.hlsUrl;
    const fullHlsUrl = window.location.origin + streamSrc;
    console.log(`[HLS] Playback URL: ${fullHlsUrl}`);

    if (Hls.isSupported()) {
      hlsPlayer = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 45,
        liveSyncDurationCount: 5,
        liveMaxLatencyDurationCount: 12,
        maxLiveSyncPlaybackRate: 1.08,
        abrEwmaFastLive: 3,
        abrEwmaSlowLive: 9,
        fragLoadingMaxRetry: 10,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 8000,
        manifestLoadingMaxRetry: Infinity,
        manifestLoadingRetryDelay: 1500,
        manifestLoadingMaxRetryTimeout: 8000
      });

      hlsPlayer.loadSource(streamSrc);
      hlsPlayer.attachMedia(videoElement);

      hlsPlayer.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log("[HLS] Stream source is online!");
        videoPlaceholder.classList.add("hidden");
        videoElement.classList.remove("hidden");
        const hasAudio = (data.audioTracks && data.audioTracks.length > 0) ||
          (data.levels || []).some(level => level.audioCodec || level.attrs?.AUDIO);
        if (!hasAudio) {
          showToast("This stream does not include audio from the host.", "warning");
        }
        nudgeViewerPlayback();
      });

      hlsPlayer.on(Hls.Events.LEVEL_SWITCHED, () => {
        nudgeViewerPlayback();
      });

      // Handle manifest loading errors (e.g. host hasn't started streaming yet)
      hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
          videoElement.classList.add("hidden");
          videoPlaceholder.classList.remove("hidden");
          placeholderStatus.textContent = "Theater is offline. Waiting for stream to go live...";
          return;
        }

        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR || data.details === Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL) {
            nudgeViewerPlayback();
          }
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hlsPlayer.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hlsPlayer.recoverMediaError();
        } else {
          restartHlsPlayback(1500);
        }
      });

    } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari)
      videoElement.src = streamSrc;
      if (!nativeHlsMetadataHandlerAttached) {
        videoElement.addEventListener("loadedmetadata", () => {
          videoPlaceholder.classList.add("hidden");
          videoElement.classList.remove("hidden");
          nudgeViewerPlayback();
        });
        nativeHlsMetadataHandlerAttached = true;
      }
      videoElement.addEventListener("canplay", () => {
        videoPlaceholder.classList.add("hidden");
        videoElement.classList.remove("hidden");
        nudgeViewerPlayback();
      }, { once: true });
    }

    attachViewerRecoveryHandlers();
  }

  function stopHlsPlayback() {
    clearTimeout(hlsRestartTimer);
    hlsRestartTimer = null;
    clearInterval(viewerRecoveryTimer);
    viewerRecoveryTimer = null;

    if (hlsPlayer) {
      hlsPlayer.destroy();
      hlsPlayer = null;
    }

    videoElement.removeAttribute("src");
    videoElement.srcObject = null;
    videoElement.load();
  }

  function restartHlsPlayback(delay = 0) {
    clearTimeout(hlsRestartTimer);
    hlsRestartTimer = setTimeout(() => {
      if (!partyDetails || partyDetails.isHost) return;
      startHlsPlayback();
    }, delay);
  }

  function attachViewerRecoveryHandlers() {
    if (partyDetails.isHost) return;

    if (!viewerRecoveryHandlersAttached) {
      videoElement.addEventListener("waiting", nudgeViewerPlayback);
      videoElement.addEventListener("stalled", nudgeViewerPlayback);
      videoElement.addEventListener("pause", recoverFromUnexpectedPause);
      viewerRecoveryHandlersAttached = true;
    }

    if (viewerRecoveryTimer) return;

    viewerRecoveryTimer = setInterval(() => {
      if (document.hidden || videoElement.classList.contains("hidden")) return;
      if (videoElement.paused && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        nudgeViewerPlayback();
      }
      if (hlsPlayer && Number.isFinite(hlsPlayer.latency) && hlsPlayer.latency > 25) {
        hlsPlayer.startLoad();
      }
    }, 2500);
  }

  function recoverFromUnexpectedPause() {
    if (!videoElement.ended && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      nudgeViewerPlayback();
    }
  }

  function nudgeViewerPlayback() {
    if (partyDetails && partyDetails.isHost) return;

    const now = Date.now();
    if (now - lastPlaybackNudge < 700) return;
    lastPlaybackNudge = now;

    videoElement.play().catch((err) => {
      console.warn("[HLS] Autoplay blocked or playback delayed:", err);
      needsAudioUnlock = true;
      videoElement.muted = true;
      videoElement.play().catch(() => {});
      placeholderStatus.textContent = "Tap the movie screen once to enable audio.";
    });
  }

  function unlockViewerAudio() {
    if (!partyDetails || partyDetails.isHost) return;

    needsAudioUnlock = false;
    isMuted = false;
    videoElement.muted = false;
    videoElement.volume = 1;
    volumeMuteIcon.classList.add("hidden");
    volumeUpIcon.classList.remove("hidden");
    nudgeViewerPlayback();
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
    videoElement.volume = isMuted ? 0 : 1;

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
  const toggleFullscreen = () => {
    const container = document.getElementById("video-container");
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => {
        showToast("Fullscreen request blocked.", "error");
      });
    } else {
      document.exitFullscreen();
    }
  };
  fullscreenBtn.addEventListener("click", toggleFullscreen);
  if (mobileFullscreenBtn) {
    mobileFullscreenBtn.addEventListener("click", toggleFullscreen);
  }
  videoContainer.addEventListener("click", () => {
    if (needsAudioUnlock) {
      unlockViewerAudio();
    }
  });

  // 7. Live Ephemeral Chat Submission
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !socket || !joinedCurrentSocket) return;

    const messageId = `${currentUser.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    socket.emit("chat-message", { text, messageId });
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

  function appendChatMessage(message) {
    const sender = message.email || "";
    const text = message.text || "";
    const timestamp = message.timestamp || "";
    const messageId = message.messageId || `${message.userId || sender}:${timestamp}:${text}`;

    if (renderedChatMessageIds.has(messageId)) return;
    renderedChatMessageIds.add(messageId);
    if (renderedChatMessageIds.size > 200) {
      const oldestMessageId = renderedChatMessageIds.values().next().value;
      renderedChatMessageIds.delete(oldestMessageId);
    }

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

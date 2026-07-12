document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const submitBtn = document.getElementById("submit-btn");
  
  const errorContainer = document.getElementById("error-container");
  const errorTitle = document.getElementById("error-title");
  const errorMessage = document.getElementById("error-message");
  
  const infoContainer = document.getElementById("info-container");
  const infoTitle = document.getElementById("info-title");
  const infoMessage = document.getElementById("info-message");

  // Parse query params to display relevant messages
  const urlParams = new URLSearchParams(window.location.search);
  const errorParam = urlParams.get("error");
  const infoParam = urlParams.get("info");
  const inviteParam = urlParams.get("invite");

  if (errorParam) {
    showError(
      "Access Denied",
      errorParam === "no_access" 
        ? "You don't currently have permission to use this application.\nPlease contact the administrator."
        : decodeURIComponent(errorParam)
    );
  }

  if (infoParam) {
    showInfo("Session Status", decodeURIComponent(infoParam));
  }

  function showError(title, msg) {
    errorTitle.textContent = title;
    errorMessage.innerHTML = msg.replace(/\n/g, "<br>");
    errorContainer.classList.remove("hidden");
    infoContainer.classList.add("hidden");
  }

  function showInfo(title, msg) {
    infoTitle.textContent = title;
    infoMessage.innerHTML = msg.replace(/\n/g, "<br>");
    infoContainer.classList.remove("hidden");
    errorContainer.classList.add("hidden");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    errorContainer.classList.add("hidden");
    infoContainer.classList.add("hidden");
    
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
      showError("Validation Error", "Please fill in all fields.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing In...";

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password, invite: inviteParam })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      // Login success: redirect to main app page (carry invite if present)
      const redirectUrl = inviteParam ? `/app.html?invite=${encodeURIComponent(inviteParam)}` : "/lobby.html";
      window.location.href = redirectUrl;
    } catch (err) {
      showError("Authentication Failed", err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
  });
});

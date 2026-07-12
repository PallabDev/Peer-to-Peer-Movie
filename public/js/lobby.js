document.addEventListener("DOMContentLoaded", async () => {
  const navUsername = document.getElementById("nav-username");
  const adminPanelLink = document.getElementById("admin-panel-link");
  const logoutBtn = document.getElementById("logout-btn");

  // Read and display errors if present in query string
  const urlParams = new URLSearchParams(window.location.search);
  const errorParam = urlParams.get("error");
  if (errorParam) {
    const errorContainer = document.getElementById("error-container");
    const errorMessage = document.getElementById("error-message");
    if (errorContainer && errorMessage) {
      errorMessage.textContent = errorParam;
      errorContainer.classList.remove("hidden");
    }
  }

  try {
    // 1. Fetch current profile status
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      window.location.href = "/login.html?info=Session+expired";
      return;
    }
    const data = await res.json();
    const currentUser = data.user;

    // 2. Bind info details
    navUsername.textContent = currentUser.email;

    if (currentUser.role === "admin") {
      adminPanelLink.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Profile check failed in lobby:", err);
    window.location.href = "/login.html";
  }

  // 3. Bind logout actions
  logoutBtn.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST"
      });
      if (response.ok) {
        window.location.href = "/login.html";
      } else {
        alert("Error logging out.");
      }
    } catch (err) {
      console.error("Logout failed:", err);
      window.location.href = "/login.html";
    }
  });
});

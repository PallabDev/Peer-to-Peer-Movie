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

// Read URL query params
const params = new URLSearchParams(window.location.search);
const errorParam = params.get("error");

if (errorParam === "pending") {
  showInfo("Access Pending", "Your account has been registered successfully. Please wait for an administrator to approve your access before logging in.");
}

function showError(title, msg) {
  errorTitle.textContent = title;
  errorMessage.textContent = msg;
  errorContainer.classList.remove("hidden");
  infoContainer.classList.add("hidden");
}

function showInfo(title, msg) {
  infoTitle.textContent = title;
  infoMessage.textContent = msg;
  infoContainer.classList.remove("hidden");
  errorContainer.classList.add("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorContainer.classList.add("hidden");
  infoContainer.classList.add("hidden");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError("Validation Error", "All fields are required.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing In...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Login request failed.");
    }

    // Successful login: redirect to the lobby
    window.location.href = "/lobby.html";
  } catch (err) {
    showError("Login Failed", err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";
  }
});

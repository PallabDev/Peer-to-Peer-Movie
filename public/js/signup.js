const form = document.getElementById("signup-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("submit-btn");

const errorContainer = document.getElementById("error-container");
const errorTitle = document.getElementById("error-title");
const errorMessage = document.getElementById("error-message");

const infoContainer = document.getElementById("info-container");
const infoTitle = document.getElementById("info-title");
const infoMessage = document.getElementById("info-message");

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

  if (password.length < 6) {
    showError("Password Length", "Password must be at least 6 characters.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Registration failed.");
    }

    showInfo("Request Received", data.message);
    form.reset();
    submitBtn.classList.add("hidden");
  } catch (err) {
    showError("Registration Failed", err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Request";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const usersTableBody = document.getElementById("users-table-body");
  const createUserForm = document.getElementById("create-user-form");
  const newEmailInput = document.getElementById("new-email");
  const newPasswordInput = document.getElementById("new-password");
  const newRoleSelect = document.getElementById("new-role");
  const newHasAccessCheckbox = document.getElementById("new-hasaccess");
  const searchInput = document.getElementById("search-input");
  const logoutBtn = document.getElementById("logout-btn");
  const adminToast = document.getElementById("admin-toast");

  // Modal elements
  const resetModal = document.getElementById("reset-modal");
  const resetPasswordForm = document.getElementById("reset-password-form");
  const resetUserIdInput = document.getElementById("reset-user-id");
  const resetNewPasswordInput = document.getElementById("reset-new-password");
  const resetModalEmail = document.getElementById("reset-modal-email");
  const closeModalBtn = document.getElementById("close-modal-btn");

  let currentAdminUser = null;

  // Load profile and users initially
  init();

  async function init() {
    try {
      // Verify admin and store profile info
      const meResponse = await fetch("/api/auth/me");
      if (!meResponse.ok) {
        window.location.href = "/login.html";
        return;
      }
      const meData = await meResponse.json();
      currentAdminUser = meData.user;
      
      if (currentAdminUser.role !== "admin") {
        window.location.href = "/app.html";
        return;
      }

      await loadUsers();
    } catch (err) {
      console.error("Initialization failed:", err);
      window.location.href = "/login.html";
    }
  }

  function showToast(message, isError = false) {
    adminToast.textContent = message;
    adminToast.className = `mb-4 rounded-xl p-3 text-sm transition-all duration-300 ${
      isError 
        ? "bg-rose-500/10 border border-rose-500/20 text-rose-400" 
        : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
    }`;
    adminToast.classList.remove("hidden");
    setTimeout(() => {
      adminToast.classList.add("hidden");
    }, 4000);
  }

  async function loadUsers(searchQuery = "") {
    try {
      const url = searchQuery 
        ? `/api/admin/users?search=${encodeURIComponent(searchQuery)}` 
        : "/api/admin/users";
      
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          window.location.href = "/login.html";
          return;
        }
        throw new Error("Failed to load users");
      }

      const users = await response.json();
      renderUsers(users);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderUsers(usersList) {
    usersTableBody.innerHTML = "";

    if (usersList.length === 0) {
      usersTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="py-8 text-center text-sm text-neutral-500">
            No users found
          </td>
        </tr>
      `;
      return;
    }

    usersList.forEach(user => {
      const isSelf = currentAdminUser && currentAdminUser.id === user.id;
      
      const tr = document.createElement("tr");
      tr.className = "hover:bg-neutral-900/30 transition-colors";
      
      tr.innerHTML = `
        <td class="py-4 px-4 whitespace-nowrap text-sm font-medium text-white">
          <div class="flex items-center space-x-2">
            <span class="inline-block h-2 w-2 rounded-full ${user.role === 'admin' ? 'bg-rose-500' : 'bg-neutral-500'}"></span>
            <span>${escapeHTML(user.email)}</span>
            ${isSelf ? '<span class="ml-2 text-xs bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded-full font-normal">You</span>' : ''}
          </div>
        </td>
        <td class="py-4 px-4 whitespace-nowrap text-sm text-neutral-300">
          <select class="role-select bg-neutral-850 border-0 ring-1 ring-neutral-700/60 rounded-xl px-2 py-1 text-xs text-neutral-300 focus:ring-rose-500 focus:ring-2" 
            data-id="${user.id}" ${isSelf ? 'disabled' : ''}>
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td class="py-4 px-4 whitespace-nowrap text-sm text-neutral-300">
          <button class="access-toggle-btn inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-medium border transition ${
            user.hasAccess 
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20" 
              : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-750"
          }" data-id="${user.id}" data-access="${user.hasAccess}" ${isSelf ? 'disabled' : ''}>
            ${user.hasAccess ? "Allowed" : "Blocked"}
          </button>
        </td>
        <td class="py-4 px-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
          <button class="reset-pwd-btn text-amber-400 hover:text-amber-300 text-xs transition" data-id="${user.id}" data-email="${escapeHTML(user.email)}">
            Reset PW
          </button>
          <button class="delete-btn text-rose-500 hover:text-rose-400 text-xs transition ${isSelf ? 'opacity-30 cursor-not-allowed' : ''}" 
            data-id="${user.id}" ${isSelf ? 'disabled' : ''}>
            Delete
          </button>
        </td>
      `;

      usersTableBody.appendChild(tr);
    });

    // Attach event listeners to dynamic elements
    document.querySelectorAll(".role-select").forEach(el => {
      el.addEventListener("change", handleRoleChange);
    });

    document.querySelectorAll(".access-toggle-btn").forEach(el => {
      el.addEventListener("click", handleAccessToggle);
    });

    document.querySelectorAll(".reset-pwd-btn").forEach(el => {
      el.addEventListener("click", openResetModal);
    });

    document.querySelectorAll(".delete-btn").forEach(el => {
      el.addEventListener("click", handleDeleteUser);
    });
  }

  // Handle User Creation
  createUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const email = newEmailInput.value.trim();
    const password = newPasswordInput.value;
    const role = newRoleSelect.value;
    const hasAccess = newHasAccessCheckbox.checked;

    if (!email || !password) {
      showToast("Please provide both email and password.", true);
      return;
    }

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role, hasAccess })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create user");
      }

      showToast(`User '${email}' created successfully.`);
      newEmailInput.value = "";
      newPasswordInput.value = "";
      newHasAccessCheckbox.checked = true;
      
      await loadUsers(searchInput.value);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Handle Search input
  let searchTimeout;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadUsers(e.target.value);
    }, 300);
  });

  // Handle Role Change Dropdown
  async function handleRoleChange(e) {
    const id = e.target.dataset.id;
    const role = e.target.value;

    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update role");

      showToast("Role updated successfully.");
      await loadUsers(searchInput.value);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // Handle Access Permission Toggle
  async function handleAccessToggle(e) {
    const id = e.target.dataset.id;
    const currentAccess = e.target.dataset.access === "true";
    const nextAccess = !currentAccess;

    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hasAccess: nextAccess })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to toggle access");

      showToast(`Access status updated successfully.`);
      await loadUsers(searchInput.value);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // Delete User
  async function handleDeleteUser(e) {
    const id = e.target.dataset.id;
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;

    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE"
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete user");

      showToast("User deleted successfully.");
      await loadUsers(searchInput.value);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // Open Reset Password Modal
  function openResetModal(e) {
    const id = e.target.dataset.id;
    const email = e.target.dataset.email;

    resetUserIdInput.value = id;
    resetModalEmail.textContent = `Resetting password for: ${email}`;
    resetNewPasswordInput.value = "";
    resetModal.classList.remove("hidden");
  }

  // Close Reset Modal
  closeModalBtn.addEventListener("click", () => {
    resetModal.classList.add("hidden");
  });

  // Submit Password Reset Form
  resetPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const id = resetUserIdInput.value;
    const password = resetNewPasswordInput.value;

    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to reset password");

      showToast("Password updated successfully.");
      resetModal.classList.add("hidden");
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Handle Logout
  logoutBtn.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST"
      });
      if (response.ok) {
        window.location.href = "/login.html";
      } else {
        showToast("Error logging out", true);
      }
    } catch (err) {
      console.error(err);
      window.location.href = "/login.html";
    }
  });

  // Utility to escape HTML text
  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
  }
});

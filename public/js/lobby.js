document.addEventListener("DOMContentLoaded", async () => {
  const navUsername = document.getElementById("nav-username");
  const logoutBtn = document.getElementById("logout-btn");
  const createPartyForm = document.getElementById("create-party-form");
  const partyTitleInput = document.getElementById("party-title");
  const partiesContainer = document.getElementById("parties-container");
  const activePartiesCountBadge = document.getElementById("active-parties-count");

  const adminPanel = document.getElementById("admin-panel");
  const usersTableBody = document.getElementById("users-table-body");

  let currentUser = null;

  // 1. Verify Authentication & Permissions
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      window.location.href = "/login.html";
      return;
    }
    const data = await res.json();
    currentUser = data.user;

    navUsername.textContent = currentUser.email;

    // Load Admin Controls if User is Admin
    if (currentUser.role === "admin") {
      adminPanel.classList.remove("hidden");
      loadAdminUsersList();
    }

    // Load Active Parties List
    loadActiveParties();
    // Poll active parties every 10 seconds to keep viewer count updated
    setInterval(loadActiveParties, 10000);

  } catch (err) {
    console.error("Lobby session verification failed:", err);
    window.location.href = "/login.html";
  }

  // 2. Fetch and Render Active Parties
  async function loadActiveParties() {
    try {
      const res = await fetch("/api/parties");
      if (!res.ok) throw new Error("Failed to scan parties");
      const list = await res.json();

      activePartiesCountBadge.textContent = `${list.length} active`;

      if (list.length === 0) {
        partiesContainer.innerHTML = `
          <div class="text-center py-12 text-neutral-500 text-sm select-none italic">
            No active watch parties at the moment. Start one on the left!
          </div>
        `;
        return;
      }

      partiesContainer.innerHTML = list.map(party => `
        <div class="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center justify-between gap-4 hover:border-neutral-700/60 transition shadow-sm group">
          <div>
            <h3 class="text-base font-bold text-neutral-100 group-hover:text-rose-400 transition">${escapeHtml(party.title)}</h3>
            <p class="text-xs text-neutral-400 mt-1">Host: <span class="text-neutral-300 font-medium">${escapeHtml(party.hostEmail || "System")}</span></p>
          </div>
          <div class="flex items-center space-x-4 flex-shrink-0">
            <span class="text-xs bg-rose-500/10 text-rose-400 px-2 py-1 rounded font-semibold select-none">
              ${party.viewerCount} / 4 Viewers
            </span>
            <a href="/app.html?party=${party.id}" 
              class="inline-flex items-center justify-center rounded-xl bg-rose-500 hover:bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-rose-500/10 transition active:scale-[0.98]">
              Join Theater
            </a>
          </div>
        </div>
      `).join("");

    } catch (err) {
      console.error("Failed to load active parties:", err);
    }
  }

  // 3. Create Watch Party Form Handler
  createPartyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = partyTitleInput.value.trim();
    if (!title) return;

    try {
      const res = await fetch("/api/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create watch party.");
      }

      // Automatically redirect the creator directly into the new theater room
      window.location.href = `/app.html?party=${data.party.id}`;
    } catch (err) {
      alert(err.message);
    }
  });

  // 4. Log Out Handler
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login.html";
    } catch (err) {
      window.location.href = "/login.html";
    }
  });

  // 5. Admin: Load all users
  async function loadAdminUsersList() {
    try {
      const res = await fetch("/api/auth/users");
      if (!res.ok) throw new Error("Failed to load user list");
      const list = await res.json();

      if (list.length === 0) {
        usersTableBody.innerHTML = `
          <tr>
            <td colspan="4" class="text-center py-6 text-neutral-500 italic">No users registered in database.</td>
          </tr>
        `;
        return;
      }

      usersTableBody.innerHTML = list.map(user => `
        <tr class="hover:bg-neutral-900/10 transition">
          <td class="px-6 py-4 font-medium text-neutral-200">${escapeHtml(user.email)}</td>
          <td class="px-6 py-4"><span class="text-xs uppercase px-2 py-0.5 rounded ${user.role === 'admin' ? 'bg-amber-500/10 text-amber-400 font-semibold' : 'bg-neutral-800 text-neutral-400'}">${user.role}</span></td>
          <td class="px-6 py-4">
            <span class="inline-flex items-center text-xs font-semibold ${user.hasAccess ? 'text-emerald-400' : 'text-rose-400'}">
              <span class="mr-1.5 h-1.5 w-1.5 rounded-full ${user.hasAccess ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}"></span>
              ${user.hasAccess ? 'Approved' : 'Access Denied'}
            </span>
          </td>
          <td class="px-6 py-4 text-right">
            ${user.role === 'admin' 
              ? '<span class="text-xs text-neutral-600 italic select-none">Admin has master access</span>' 
              : `<button data-id="${user.id}" data-access="${user.hasAccess}" class="toggle-access-btn rounded-xl px-3 py-1.5 text-xs font-bold transition active:scale-[0.98] ${
                  user.hasAccess 
                    ? "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20" 
                    : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                }">
                  ${user.hasAccess ? "Revoke Access" : "Grant Access"}
                </button>`
            }
          </td>
        </tr>
      `).join("");

      // Bind access status toggling click events
      document.querySelectorAll(".toggle-access-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          const userId = e.target.getAttribute("data-id");
          const currentAccess = e.target.getAttribute("data-access") === "true";
          const newAccessState = !currentAccess;

          try {
            const toggleRes = await fetch(`/api/auth/users/${userId}/access`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ hasAccess: newAccessState })
            });

            if (!toggleRes.ok) throw new Error("Failed to modify user access");
            loadAdminUsersList(); // reload listing
          } catch (err) {
            alert(err.message);
          }
        });
      });

    } catch (err) {
      console.error("Admin user list fetch failed:", err);
    }
  }

  // Helper function to escape HTML entities
  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
});

const state = {
  user: null,
  menus: [],
  currentMenu: "dashboard",
  users: [],
  confirmAction: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const loginView = $("#loginView");
const appView = $("#appView");
const pageContent = $("#pageContent");
const pageTitle = $("#pageTitle");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindStaticEvents();
  await restoreSession();
}

function bindStaticEvents() {
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#logoutButton").addEventListener("click", handleLogout);
  $("#accountButton").addEventListener("click", () => openModal("passwordModal"));
  $("#passwordForm").addEventListener("submit", handlePasswordChange);
  $("#userForm").addEventListener("submit", saveUser);

  $("#openSidebar").addEventListener("click", openSidebar);
  $("#closeSidebar").addEventListener("click", closeSidebar);
  $("#sidebarBackdrop").addEventListener("click", closeSidebar);

  $("#selectAllPermissions").addEventListener("click", () => {
    $$(".permission-checkbox").forEach(input => input.checked = true);
  });
  $("#clearPermissions").addEventListener("click", () => {
    $$(".permission-checkbox").forEach(input => input.checked = false);
  });

  $("#confirmActionButton").addEventListener("click", async () => {
    if (typeof state.confirmAction === "function") {
      const action = state.confirmAction;
      state.confirmAction = null;
      closeModal("confirmModal");
      await action();
    }
  });

  document.addEventListener("click", event => {
    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) closeModal(closeButton.dataset.closeModal);

    const toggle = event.target.closest("[data-toggle-password]");
    if (toggle) {
      const input = document.getElementById(toggle.dataset.togglePassword);
      input.type = input.type === "password" ? "text" : "password";
    }
  });

  $$(".modal").forEach(modal => {
    modal.addEventListener("click", event => {
      if (event.target === modal) closeModal(modal.id);
    });
  });
}

async function restoreSession() {
  try {
    const data = await api("/api/session", { allowUnauthorized: true });
    if (data.authenticated) {
      state.user = data.user;
      state.menus = data.menus;
      showApp();
    } else {
      showLogin(data.setupReady);
    }
  } catch (error) {
    showLogin(false);
    showFormMessage("#loginMessage", error.message);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const button = $("#loginButton");
  const username = $("#loginUsername").value.trim();
  const password = $("#loginPassword").value;

  setLoading(button, true, "Memeriksa...");
  hideFormMessage("#loginMessage");

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: { username, password },
      allowUnauthorized: true
    });
    state.user = data.user;
    state.menus = data.menus;
    $("#loginForm").reset();
    showApp();
    toast(`Selamat datang, ${state.user.username}.`, "success");
  } catch (error) {
    showFormMessage("#loginMessage", error.message);
  } finally {
    setLoading(button, false);
  }
}

async function handleLogout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (_) {
    // Tetap kembali ke layar login walaupun sesi server sudah hilang.
  }
  state.user = null;
  state.menus = [];
  state.users = [];
  showLogin(true);
}

function showLogin(setupReady = true) {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  if (!setupReady) {
    showFormMessage(
      "#loginMessage",
      "Database atau akun master belum siap. Pastikan binding DB dan secret MASTER_USERNAME serta MASTER_PASSWORD sudah dibuat di Cloudflare, lalu deploy ulang."
    );
  }
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");

  const initial = state.menus.some(menu => menu.id === state.currentMenu)
    ? state.currentMenu
    : (state.menus[0]?.id || "dashboard");

  renderUserIdentity();
  renderMenu();
  navigate(initial);
}

function renderUserIdentity() {
  const initial = escapeHtml(state.user.username.charAt(0).toUpperCase());
  const role = state.user.isMaster ? "Master Administrator" : "User";
  const identity = `
    <span class="avatar">${initial}</span>
    <span class="user-copy">
      <strong>${escapeHtml(state.user.username)}</strong>
      <span>${role}</span>
    </span>`;

  $("#sidebarUser").innerHTML = identity;
  $("#accountButton").innerHTML = `
    <span class="avatar">${initial}</span>
    <span>${escapeHtml(state.user.username)}</span>`;
}

function renderMenu() {
  const menuList = $("#menuList");
  menuList.innerHTML = state.menus.map(menu => `
    <button class="menu-item" type="button" data-menu="${escapeHtml(menu.id)}">
      <span class="menu-icon">${escapeHtml(menu.icon)}</span>
      <span>${escapeHtml(menu.label)}</span>
    </button>
  `).join("");

  menuList.addEventListener("click", event => {
    const button = event.target.closest("[data-menu]");
    if (button) navigate(button.dataset.menu);
  });
}

async function navigate(menuId) {
  const menu = state.menus.find(item => item.id === menuId);
  if (!menu) return;

  state.currentMenu = menuId;
  pageTitle.textContent = menu.label;
  $$(".menu-item").forEach(button => {
    button.classList.toggle("active", button.dataset.menu === menuId);
  });
  closeSidebar();

  if (menuId === "dashboard") {
    renderDashboard();
    return;
  }
  if (menuId === "user-admin") {
    await renderUserAdmin();
    return;
  }
  await renderModule(menu);
}

function renderDashboard() {
  const accessible = state.menus.filter(menu => menu.id !== "dashboard");
  pageContent.innerHTML = `
    <section class="hero-card">
      <div class="hero-content">
        <span class="eyebrow">WELCOME BACK</span>
        <h1>Halo, ${escapeHtml(state.user.username)} 👋</h1>
        <p>Panel kamu sudah aktif. Semua menu di bawah mengikuti hak akses akun yang diberikan oleh master.</p>
      </div>
    </section>

    <section class="stats-grid">
      <article class="stat-card">
        <div class="stat-top"><span class="stat-icon">▦</span><span class="badge active">AKTIF</span></div>
        <strong>${accessible.length}</strong><span>Menu dapat diakses</span>
      </article>
      <article class="stat-card">
        <div class="stat-top"><span class="stat-icon">◉</span><span class="badge active">ONLINE</span></div>
        <strong>100%</strong><span>Status sistem</span>
      </article>
      <article class="stat-card">
        <div class="stat-top"><span class="stat-icon">◆</span><span class="badge master">${state.user.isMaster ? "MASTER" : "USER"}</span></div>
        <strong>${state.user.isMaster ? "ALL" : "LIMIT"}</strong><span>Tingkat akses</span>
      </article>
      <article class="stat-card">
        <div class="stat-top"><span class="stat-icon">⌁</span><span class="badge active">AMAN</span></div>
        <strong>12h</strong><span>Masa sesi login</span>
      </article>
    </section>

    <section class="section-block">
      <div class="section-title-row">
        <div><h3>Akses cepat</h3><p>Buka menu yang paling sering digunakan.</p></div>
      </div>
      <div class="quick-grid">
        ${accessible.slice(0, 6).map(menu => `
          <button class="quick-card" type="button" data-quick-menu="${escapeHtml(menu.id)}">
            <span class="quick-icon">${escapeHtml(menu.icon)}</span>
            <span><strong>${escapeHtml(menu.label)}</strong><span>Buka modul →</span></span>
          </button>
        `).join("") || `
          <div class="content-card" style="padding:20px">
            Belum ada menu tambahan untuk akun ini.
          </div>`}
      </div>
    </section>`;

  $$("[data-quick-menu]").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.quickMenu));
  });
}

async function renderModule(menu) {
  pageContent.innerHTML = loadingHtml();
  try {
    const data = await api(`/api/module/${encodeURIComponent(menu.id)}`);
    pageContent.innerHTML = `
      <section class="module-shell">
        <div class="module-head">
          <div class="module-big-icon">${escapeHtml(menu.icon)}</div>
          <div>
            <span class="eyebrow">AUTHORIZED MODULE</span>
            <h3>${escapeHtml(menu.label)}</h3>
            <p>${escapeHtml(data.message)}</p>
          </div>
        </div>
        <div class="empty-state">
          <div>
            <div class="empty-icon">${escapeHtml(menu.icon)}</div>
            <h4>Menu ${escapeHtml(menu.label)} sudah siap</h4>
            <p>Halaman ini sudah dilindungi hak akses dari server. Isi fitur asli menu dapat ditempel pada bagian ini tanpa mengubah sistem login.</p>
          </div>
        </div>
      </section>`;
  } catch (error) {
    pageContent.innerHTML = errorState(error.message);
  }
}

async function renderUserAdmin() {
  pageContent.innerHTML = loadingHtml();
  try {
    const data = await api("/api/users");
    state.users = data.users;

    pageContent.innerHTML = `
      <section class="user-toolbar">
        <div>
          <span class="eyebrow">MASTER ACCESS</span>
          <h3>Manajemen pengguna</h3>
          <p>Daftarkan akun dan tentukan menu yang dapat dibuka.</p>
        </div>
        <button id="addUserButton" class="primary-button" type="button">＋ Tambah akun</button>
      </section>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pengguna</th>
              <th>Peran</th>
              <th>Status</th>
              <th>Akses menu</th>
              <th>Dibuat</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${state.users.map(renderUserRow).join("")}
          </tbody>
        </table>
      </div>`;

    $("#addUserButton").addEventListener("click", () => openUserForm());
    $$("[data-edit-user]").forEach(button => {
      button.addEventListener("click", () => {
        const user = state.users.find(item => String(item.id) === button.dataset.editUser);
        if (user) openUserForm(user);
      });
    });
    $$("[data-delete-user]").forEach(button => {
      button.addEventListener("click", () => {
        const user = state.users.find(item => String(item.id) === button.dataset.deleteUser);
        if (user) confirmDeleteUser(user);
      });
    });
  } catch (error) {
    pageContent.innerHTML = errorState(error.message);
  }
}

function renderUserRow(user) {
  const permissionLabels = user.isMaster
    ? ["Semua menu"]
    : user.permissions.map(id => state.menus.find(menu => menu.id === id)?.label || id);

  return `
    <tr>
      <td>
        <div class="table-user">
          <span class="avatar">${escapeHtml(user.username.charAt(0).toUpperCase())}</span>
          <strong>${escapeHtml(user.username)}</strong>
        </div>
      </td>
      <td><span class="badge ${user.isMaster ? "master" : ""}">${user.isMaster ? "Master" : "User"}</span></td>
      <td><span class="badge ${user.active ? "active" : "inactive"}">${user.active ? "Aktif" : "Nonaktif"}</span></td>
      <td>
        <div class="permission-chips">
          ${(permissionLabels.length ? permissionLabels : ["Tanpa akses"]).map(label =>
            `<span class="permission-chip">${escapeHtml(label)}</span>`
          ).join("")}
        </div>
      </td>
      <td>${escapeHtml(formatDate(user.createdAt))}</td>
      <td>
        ${user.isMaster ? `<span class="muted">Terkunci</span>` : `
          <div class="row-actions">
            <button class="table-action" type="button" data-edit-user="${user.id}" title="Edit">✎</button>
            <button class="table-action danger" type="button" data-delete-user="${user.id}" title="Hapus">⌫</button>
          </div>`}
      </td>
    </tr>`;
}

function openUserForm(user = null) {
  $("#userForm").reset();
  $("#editUserId").value = user ? user.id : "";
  $("#userModalTitle").textContent = user ? "Edit akun" : "Tambah akun";
  $("#passwordOptional").textContent = user ? "(kosongkan bila tidak diganti)" : "";
  $("#userUsername").value = user?.username || "";
  $("#userActive").checked = user ? user.active : true;
  $("#userPassword").required = !user;
  hideFormMessage("#userFormMessage");

  const assignableMenus = state.menus.filter(menu =>
    !["dashboard", "user-admin"].includes(menu.id)
  );
  $("#permissionGrid").innerHTML = assignableMenus.map(menu => `
    <label class="permission-option">
      <input class="permission-checkbox" type="checkbox" value="${escapeHtml(menu.id)}"
        ${user?.permissions.includes(menu.id) ? "checked" : ""}>
      <span class="p-icon">${escapeHtml(menu.icon)}</span>
      <strong>${escapeHtml(menu.label)}</strong>
    </label>
  `).join("");

  openModal("userModal");
}

async function saveUser(event) {
  event.preventDefault();
  const id = $("#editUserId").value;
  const button = $("#saveUserButton");
  const permissions = $$(".permission-checkbox:checked").map(input => input.value);
  const payload = {
    username: $("#userUsername").value.trim(),
    password: $("#userPassword").value,
    active: $("#userActive").checked,
    permissions
  };

  setLoading(button, true, "Menyimpan...");
  hideFormMessage("#userFormMessage");

  try {
    await api(id ? `/api/users/${id}` : "/api/users", {
      method: id ? "PUT" : "POST",
      body: payload
    });
    closeModal("userModal");
    toast(id ? "Akun berhasil diperbarui." : "Akun baru berhasil dibuat.", "success");
    await renderUserAdmin();
  } catch (error) {
    showFormMessage("#userFormMessage", error.message);
  } finally {
    setLoading(button, false);
  }
}

function confirmDeleteUser(user) {
  $("#confirmTitle").textContent = `Hapus ${user.username}?`;
  $("#confirmText").textContent = "Akun akan langsung kehilangan akses dan data sesi login akan dihapus.";
  state.confirmAction = async () => {
    try {
      await api(`/api/users/${user.id}`, { method: "DELETE" });
      toast("Akun berhasil dihapus.", "success");
      await renderUserAdmin();
    } catch (error) {
      toast(error.message, "error");
    }
  };
  openModal("confirmModal");
}

async function handlePasswordChange(event) {
  event.preventDefault();
  const currentPassword = $("#currentPassword").value;
  const newPassword = $("#newPassword").value;
  const confirmPassword = $("#confirmPassword").value;

  hideFormMessage("#passwordMessage");
  if (newPassword !== confirmPassword) {
    showFormMessage("#passwordMessage", "Konfirmasi password baru tidak sama.");
    return;
  }

  try {
    await api("/api/change-password", {
      method: "POST",
      body: { currentPassword, newPassword }
    });
    $("#passwordForm").reset();
    closeModal("passwordModal");
    toast("Password berhasil diubah.", "success");
  } catch (error) {
    showFormMessage("#passwordMessage", error.message);
  }
}

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
  if ($$(".modal:not(.hidden)").length === 0) document.body.style.overflow = "";
}

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebarBackdrop").classList.remove("hidden");
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarBackdrop").classList.add("hidden");
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = { error: "Respons server tidak valid." };
  }

  if (response.status === 401 && !options.allowUnauthorized) {
    state.user = null;
    showLogin(true);
  }
  if (!response.ok) throw new Error(data.error || `Terjadi kesalahan (${response.status}).`);
  return data;
}

function setLoading(button, loading, text = "") {
  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

function showFormMessage(selector, message, success = false) {
  const element = $(selector);
  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.toggle("success", success);
}

function hideFormMessage(selector) {
  const element = $(selector);
  element.textContent = "";
  element.classList.add("hidden");
  element.classList.remove("success");
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  $("#toastContainer").appendChild(element);
  setTimeout(() => element.remove(), 3600);
}

function loadingHtml() {
  return `<div class="loading-block"><div><div class="spinner"></div>Memuat data...</div></div>`;
}

function errorState(message) {
  return `<section class="module-shell"><div class="empty-state"><div>
    <div class="empty-icon">⚠</div><h4>Gagal membuka halaman</h4>
    <p>${escapeHtml(message)}</p>
  </div></div></section>`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

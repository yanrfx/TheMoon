const MENUS = Object.freeze([
  { id: "dashboard", label: "Dashboard", icon: "▦", always: true },
  { id: "checker", label: "Checker", icon: "✓", assignable: true },
  { id: "pencairan", label: "Pencairan", icon: "⇄", assignable: true },
  { id: "biaya", label: "Biaya", icon: "◈", assignable: true },
  { id: "list-data", label: "List Data", icon: "☷", assignable: true },
  { id: "hasil-result", label: "Hasil Result", icon: "◎", assignable: true },
  { id: "ai-chat", label: "AI Chat", icon: "✦", assignable: true },
  { id: "upload", label: "Upload", icon: "⇧", assignable: true },
  { id: "settings", label: "Settings", icon: "⚙", masterOnly: true },
  { id: "user-admin", label: "User Admin", icon: "♙", masterOnly: true }
]);

const COOKIE_NAME = "themoon_session";
const SESSION_TTL = 12 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 120000;
const MAX_JSON_BYTES = 32 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      if (!env.ASSETS) {
        return json({ error: "ASSETS binding tidak tersedia." }, 500);
      }

      const assetResponse = await env.ASSETS.fetch(request);
      return secureAssetResponse(assetResponse);
    } catch (error) {
      console.error(error);

      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }

      return json({ error: "Terjadi kesalahan pada server." }, 500);
    }
  }
};

async function handleApi(request, env, url) {
  if (!env.DB) {
    return json({
      error: "Binding database belum ditemukan. Tambahkan D1 binding dengan nama DB."
    }, 500);
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) {
      return json({ error: "Permintaan lintas situs ditolak." }, 403);
    }
  }

  await ensureSchema(env.DB);
  const setupReady = await ensureMaster(env);

  if (url.pathname === "/api/public-settings" && request.method === "GET") {
    const backgroundUrl = await readSetting(env.DB, "background_url");
    return json({ backgroundUrl: backgroundUrl || "" });
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const user = await sessionUser(request, env.DB);
    return json({
      authenticated: Boolean(user),
      setupReady,
      user: user ? publicUser(user) : null,
      menus: user ? menusForUser(user) : []
    });
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    if (!setupReady) {
      return json({
        error: "Akun master belum siap. Periksa MASTER_USERNAME dan MASTER_PASSWORD."
      }, 503);
    }
    return login(request, env.DB);
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return logout(request, env.DB);
  }

  const user = await sessionUser(request, env.DB);
  if (!user) return json({ error: "Sesi login habis. Silakan masuk kembali." }, 401);

  if (url.pathname === "/api/change-password" && request.method === "POST") {
    return changePassword(request, env.DB, user);
  }

  if (url.pathname === "/api/users" && request.method === "GET") {
    return listUsers(env.DB, user);
  }

  if (url.pathname === "/api/users" && request.method === "POST") {
    return createUser(request, env.DB, user);
  }

  const userRoute = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (userRoute && request.method === "PUT") {
    return updateUser(request, env.DB, user, Number(userRoute[1]));
  }
  if (userRoute && request.method === "DELETE") {
    return deleteUser(env.DB, user, Number(userRoute[1]));
  }

  if (url.pathname === "/api/settings/background" && request.method === "GET") {
    if (!isMaster(user)) return forbidden();
    return json({ backgroundUrl: (await readSetting(env.DB, "background_url")) || "" });
  }

  if (url.pathname === "/api/settings/background" && request.method === "PUT") {
    if (!isMaster(user)) return forbidden();
    return updateBackground(request, env.DB, user);
  }

  const moduleRoute = url.pathname.match(/^\/api\/module\/([a-z0-9-]+)$/);
  if (moduleRoute && request.method === "GET") {
    return openModule(user, moduleRoute[1]);
  }

  return json({ error: "Endpoint tidak ditemukan." }, 404);
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        username_norm TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        is_master INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by INTEGER
      )
    `),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`)
  ]);
}

async function ensureMaster(env) {
  const existingMaster = await env.DB.prepare(`
    SELECT id FROM users WHERE is_master = 1 LIMIT 1
  `).first();

  if (existingMaster) return true;

  const username = String(env.MASTER_USERNAME || "").trim();
  const password = String(env.MASTER_PASSWORD || "");

  if (!validUsername(username) || password.length < 6) return false;

  const usernameNorm = normalizeUsername(username);
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const permissions = JSON.stringify(assignableMenuIds());

  const existingUser = await env.DB.prepare(`
    SELECT id FROM users WHERE username_norm = ? LIMIT 1
  `).bind(usernameNorm).first();

  if (existingUser) {
    await env.DB.prepare(`
      UPDATE users
      SET username = ?, password_hash = ?, permissions = ?,
          is_master = 1, active = 1, updated_at = ?
      WHERE id = ?
    `).bind(username, passwordHash, permissions, now, existingUser.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO users
        (username, username_norm, password_hash, permissions, is_master, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `).bind(username, usernameNorm, passwordHash, permissions, now, now).run();
  }

  return true;
}

async function login(request, db) {
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    return json({ error: "Username dan password wajib diisi." }, 400);
  }

  const user = await db.prepare(`
    SELECT * FROM users WHERE username_norm = ? LIMIT 1
  `).bind(normalizeUsername(username)).first();

  const valid = user
    && Number(user.active) === 1
    && await verifyPassword(password, user.password_hash);

  if (!valid) {
    return json({ error: "Username atau password salah." }, 401);
  }

  const rawToken = randomToken(32);
  const tokenHash = await sha256(rawToken);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL;

  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(tokenHash, user.id, expiresAt, now).run();

  return json(
    { user: publicUser(user), menus: menusForUser(user) },
    200,
    { "Set-Cookie": sessionCookie(rawToken, Math.floor(SESSION_TTL / 1000)) }
  );
}

async function logout(request, db) {
  const token = cookieValue(request.headers.get("Cookie"), COOKIE_NAME);

  if (token) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token)).run();
  }

  return json(
    { success: true },
    200,
    { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }
  );
}

async function sessionUser(request, db) {
  const token = cookieValue(request.headers.get("Cookie"), COOKIE_NAME);
  if (!token) return null;

  return await db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.expires_at > ?
      AND u.active = 1
    LIMIT 1
  `).bind(await sha256(token), Date.now()).first();
}

async function changePassword(request, db, user) {
  const body = await readJson(request);
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");

  if (newPassword.length < 8 || newPassword.length > 128) {
    return json({ error: "Password baru harus 8–128 karakter." }, 400);
  }

  if (!await verifyPassword(currentPassword, user.password_hash)) {
    return json({ error: "Password sekarang salah." }, 400);
  }

  await db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
  `).bind(await hashPassword(newPassword), Date.now(), user.id).run();

  return json({ success: true });
}

async function listUsers(db, user) {
  if (!isMaster(user)) return forbidden();

  const result = await db.prepare(`
    SELECT id, username, permissions, is_master, active, created_at, updated_at
    FROM users
    ORDER BY is_master DESC, username_norm ASC
  `).all();

  return json({
    users: (result.results || []).map(row => ({
      id: row.id,
      username: row.username,
      permissions: safePermissions(row.permissions),
      isMaster: Number(row.is_master) === 1,
      active: Number(row.active) === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  });
}

async function createUser(request, db, master) {
  if (!isMaster(master)) return forbidden();

  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const permissions = sanitizePermissions(body.permissions);
  const active = body.active === false ? 0 : 1;

  if (!validUsername(username)) {
    return json({
      error: "Username harus 3–40 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau minus."
    }, 400);
  }

  if (password.length < 6 || password.length > 128) {
    return json({ error: "Password harus 6–128 karakter." }, 400);
  }

  const now = Date.now();

  try {
    const result = await db.prepare(`
      INSERT INTO users
        (username, username_norm, password_hash, permissions, is_master, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
    `).bind(
      username,
      normalizeUsername(username),
      await hashPassword(password),
      JSON.stringify(permissions),
      active,
      now,
      now
    ).run();

    return json({ success: true, id: result.meta?.last_row_id }, 201);
  } catch (error) {
    if (String(error.message || error).toLowerCase().includes("unique")) {
      return json({ error: "Username tersebut sudah digunakan." }, 409);
    }
    throw error;
  }
}

async function updateUser(request, db, master, targetId) {
  if (!isMaster(master)) return forbidden();

  const target = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .bind(targetId).first();

  if (!target) return json({ error: "Akun tidak ditemukan." }, 404);
  if (Number(target.is_master) === 1) {
    return json({ error: "Akun master tidak dapat diedit melalui menu ini." }, 403);
  }

  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const permissions = sanitizePermissions(body.permissions);
  const active = body.active === false ? 0 : 1;

  if (!validUsername(username)) {
    return json({ error: "Format username tidak valid." }, 400);
  }

  if (password && (password.length < 6 || password.length > 128)) {
    return json({ error: "Password harus 6–128 karakter." }, 400);
  }

  try {
    await db.prepare(`
      UPDATE users
      SET username = ?, username_norm = ?, password_hash = ?,
          permissions = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      username,
      normalizeUsername(username),
      password ? await hashPassword(password) : target.password_hash,
      JSON.stringify(permissions),
      active,
      Date.now(),
      targetId
    ).run();

    if (!active) {
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId).run();
    }

    return json({ success: true });
  } catch (error) {
    if (String(error.message || error).toLowerCase().includes("unique")) {
      return json({ error: "Username tersebut sudah digunakan." }, 409);
    }
    throw error;
  }
}

async function deleteUser(db, master, targetId) {
  if (!isMaster(master)) return forbidden();

  const target = await db.prepare(`
    SELECT is_master FROM users WHERE id = ? LIMIT 1
  `).bind(targetId).first();

  if (!target) return json({ error: "Akun tidak ditemukan." }, 404);
  if (Number(target.is_master) === 1) {
    return json({ error: "Akun master tidak dapat dihapus." }, 403);
  }

  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(targetId)
  ]);

  return json({ success: true });
}

async function updateBackground(request, db, user) {
  const body = await readJson(request);
  const backgroundUrl = String(body.backgroundUrl || "").trim();

  if (backgroundUrl.length > 2000) {
    return json({ error: "Link background terlalu panjang." }, 400);
  }

  if (backgroundUrl) {
    let parsed;
    try {
      parsed = new URL(backgroundUrl);
    } catch (_) {
      return json({ error: "Format link background tidak valid." }, 400);
    }

    if (parsed.protocol !== "https:") {
      return json({ error: "Link background wajib menggunakan HTTPS." }, 400);
    }
  }

  await db.prepare(`
    INSERT INTO site_settings (key, value, updated_at, updated_by)
    VALUES ('background_url', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).bind(backgroundUrl, Date.now(), user.id).run();

  return json({ success: true, backgroundUrl });
}

async function readSetting(db, key) {
  const row = await db.prepare(`
    SELECT value FROM site_settings WHERE key = ? LIMIT 1
  `).bind(key).first();

  return row?.value || "";
}

function openModule(user, menuId) {
  const menu = MENUS.find(item => item.id === menuId);
  if (!menu) return json({ error: "Menu tidak ditemukan." }, 404);

  if (!isMaster(user)) {
    const permissions = safePermissions(user.permissions);

    if (menu.masterOnly || (menu.assignable && !permissions.includes(menuId))) {
      return forbidden();
    }
  }

  return json({
    success: true,
    module: menu.id,
    message: `Akses ke menu ${menu.label} diizinkan oleh server.`
  });
}

function menusForUser(user) {
  if (isMaster(user)) return MENUS.map(publicMenu);

  const permissions = safePermissions(user.permissions);

  return MENUS
    .filter(menu => menu.always || (menu.assignable && permissions.includes(menu.id)))
    .map(publicMenu);
}

function publicMenu(menu) {
  return { id: menu.id, label: menu.label, icon: menu.icon };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    isMaster: isMaster(user),
    active: Number(user.active) === 1
  };
}

function isMaster(user) {
  return Number(user?.is_master) === 1;
}

function forbidden() {
  return json({ error: "Kamu tidak memiliki izin untuk membuka fitur ini." }, 403);
}

function assignableMenuIds() {
  return MENUS.filter(menu => menu.assignable).map(menu => menu.id);
}

function sanitizePermissions(value) {
  const allowed = new Set(assignableMenuIds());
  const permissions = Array.isArray(value) ? value : [];
  return [...new Set(permissions.filter(permission => allowed.has(permission)))];
}

function safePermissions(value) {
  try {
    return sanitizePermissions(JSON.parse(value || "[]"));
  } catch (_) {
    return [];
  }
}

function validUsername(username) {
  return /^[A-Za-z0-9._-]{3,40}$/.test(username);
}

function normalizeUsername(username) {
  return username.trim().toLocaleLowerCase("en-US");
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_JSON_BYTES) {
    throw new HttpError(413, "Data terlalu besar.");
  }

  try {
    return await request.json();
  } catch (_) {
    throw new HttpError(400, "Format data tidak valid.");
  }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, PBKDF2_ITERATIONS);

  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, iterationText, saltText, hashText] = String(storedHash).split("$");

    if (algorithm !== "pbkdf2-sha256") return false;

    const iterations = Number(iterationText);
    if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 1000000) {
      return false;
    }

    const salt = fromBase64(saltText);
    const expected = fromBase64(hashText);
    const actual = await derivePassword(password, salt, iterations);

    return constantTimeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );

  return new Uint8Array(bits);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return difference === 0;
}

function randomToken(size) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(value) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return [...new Uint8Array(result)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cookieValue(header, name) {
  if (!header) return null;

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }

  return null;
}

function sessionCookie(token, maxAge) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function secureAssetResponse(response) {
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

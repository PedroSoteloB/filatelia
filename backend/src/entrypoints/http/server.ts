import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import fs from 'fs';
import path from 'path';

import { createPresentationFromJson } from "./middlewares/core/presentonClient";

// helpers
import { buildSlidesHTML } from './middlewares/core/openaiHtmlSlides';

const Fastify = require('fastify');

// ⚠️ AJUSTA ESTA RUTA A TU NUEVO POOL DE SQL SERVER
const { db } = require('../../infrastructure/db/sql/pool');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const PptxGenJS = require('pptxgenjs'); // para generar PPT localmente

const app = Fastify({ logger: true });


// 👇 1) Orígenes permitidos
const allowedOrigins: string[] = [
  'http://localhost:4200',
  'https://filatelia-orpin.vercel.app',
];


// 👇 2) Hook global para CORS
app.addHook(
  'onRequest',
  (
    req: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ) => {
    const origin = req.headers.origin as string | undefined;

    if (origin && allowedOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
    }

    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    reply.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );

    // Manejar preflight CORS
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
      return;
    }

    done();
  },
);

const uploadsRoot = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');


// sirve /uploads/*
app.register(require('@fastify/static'), {
  root: uploadsRoot,
  prefix: '/uploads/',           // => http://.../uploads/filename.jpg
  decorateReply: false,
});

function toPublicUrl(p?: string | null): string | null {
  if (!p) return null;
  const s = String(p);

  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/uploads/')) return s;
  if (s.startsWith('uploads/')) return `/${s}`;

  const root = path.resolve(uploadsRoot);
  const abs  = path.resolve(s);
  if (abs.startsWith(root)) {
    const rel = abs.slice(root.length).replace(/^[\\/]+/, '');
    return `/uploads/${rel.replace(/\\/g, '/')}`;
  }
  return null;
}




// Multipart para subir imágenes
const fastifyMultipart = require('@fastify/multipart');
app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// ------------------- helpers -------------------
function toAbsoluteUrl(relPath?: string | null): string | null {
  if (!relPath) return null;
  const base = process.env.PUBLIC_BASE_URL || "https://tu-dominio.com";
  if (/^https?:\/\//i.test(relPath)) return relPath;
  return `${base.replace(/\/+$/, "")}/${relPath.replace(/^\/+/, "")}`;
}

function ensureAuth(req: any) {
  const id = Number(req?.user?.sub);
  if (!Number.isFinite(id)) throw new Error('UNAUTHORIZED');
  return id;
}

function parseJsonSafely<T = any>(raw: any, fallback: T): T {
  try {
    if (raw == null) return fallback;
    if (typeof raw === 'string') return JSON.parse(raw);
    return raw;
  } catch {
    return fallback;
  }
}

function buildWhereFromFilter(ownerId: number, f: any) {
  const where: string[] = ['i.owner_user_id = ?'];
  const params: any[] = [ownerId];

  if (f?.country) { where.push('i.country = ?'); params.push(String(f.country)); }
  if (f?.condition) { where.push('i.condition_code = ?'); params.push(String(f.condition)); }
  if (Number.isFinite(Number(f?.yearFrom))) { where.push('i.issue_year >= ?'); params.push(Number(f.yearFrom)); }
  if (Number.isFinite(Number(f?.yearTo)))   { where.push('i.issue_year <= ?'); params.push(Number(f.yearTo)); }
  if (f?.q) {
    where.push('(i.title LIKE ? OR i.description LIKE ? OR i.catalog_code LIKE ?)');
    const like = `%${f.q}%`; params.push(like, like, like);
  }

  const tagIds = Array.isArray(f?.tagIds) ? f.tagIds.map((x: any) => Number(x)).filter(Number.isFinite) : [];
  const tagNames = Array.isArray(f?.tagNames) ? f.tagNames.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const tagMode = (String(f?.tagsMode || 'OR').toUpperCase() === 'AND') ? 'AND' : 'OR';

  const attrFilters = Array.isArray(f?.attrs) ? f.attrs : [];

  return { where, params, tagIds, tagNames, tagMode, attrFilters };
}

// ---- schema helpers: detectar columnas y cachear ----
const schemaCache: Record<string, Record<string, boolean>> = {};

async function hasColumn(table: string, column: string): Promise<boolean> {
  if (!schemaCache[table]) schemaCache[table] = {};
  if (schemaCache[table][column] != null) return schemaCache[table][column];

  // SQL SERVER: sin DATABASE(), sin LIMIT
  const [rows]: any = await db.execute(
    `SELECT TOP 1 1
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  schemaCache[table][column] = Array.isArray(rows) && rows.length > 0;
  return schemaCache[table][column];
}

// where para filtrar por dueño si la tabla tags tiene owner_user_id
async function tagsOwnerWhere(ownerId: number) {
  const scoped = await hasColumn('tags', 'owner_user_id');
  return scoped ? { where: 'owner_user_id = ?', params: [ownerId] } : { where: '1=1', params: [] };
}

// Genera JOINs por filtros de atributos (modo AND entre filtros)
async function buildAttrJoins(ownerId: number, attrFilters: any[]): Promise<{ join: string; params: any[] }> {
  if (!Array.isArray(attrFilters) || attrFilters.length === 0) return { join: '', params: [] };

  const joins: string[] = [];
  const params: any[] = [];
  const isDate = (s: any) =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim()); // YYYY-MM-DD

  let idx = 0;
  for (const f of attrFilters) {
    idx++;
    const alias = `af${idx}`;
    const nameOrId = f?.id ?? f?.name;
    if (nameOrId == null) continue;

    // 1) Resolver attribute_id
    let attributeId: number | null = null;
    if (Number.isFinite(Number(nameOrId))) {
      attributeId = Number(nameOrId);
    } else {
      const [a]: any = await db.execute(
        `SELECT TOP 1 id FROM attribute_definitions WHERE owner_user_id = ? AND name = ?`,
        [ownerId, String(nameOrId)]
      );
      if (a?.length) attributeId = Number(a[0].id);
    }
    if (!Number.isFinite(attributeId)) continue;

    // 2) Construir condición según operador/tipo
    const op = String(f?.op || '=').toLowerCase();
    let cond = '';
    const localParams: any[] = [];

    if (op === 'between' && (f?.from != null) && (f?.to != null)) {
      const from = f.from;
      const to = f.to;

      if (typeof from === 'number' && typeof to === 'number' && Number.isFinite(from) && Number.isFinite(to)) {
        cond = `ia.value_number BETWEEN ? AND ?`;
        localParams.push(from, to);
      } else if (isDate(from) && isDate(to)) {
        cond = `ia.value_date BETWEEN ? AND ?`;
        localParams.push(from, to);
      } else {
        cond = `ia.value_text BETWEEN ? AND ?`;
        localParams.push(String(from), String(to));
      }
    } else if (op === 'like' && f?.value != null) {
      cond = `ia.value_text LIKE ?`;
      localParams.push(`%${String(f.value)}%`);
    } else {
      const v = f?.value;
      if (v == null) continue;

      if (typeof v === 'number' && Number.isFinite(v)) {
        cond = `ia.value_number = ?`;
        localParams.push(v);
      } else if (isDate(v)) {
        cond = `ia.value_date = ?`;
        localParams.push(v);
      } else {
        cond = `ia.value_text = ?`;
        localParams.push(String(v));
      }
    }

    joins.push(`
      JOIN (
        SELECT ia.item_id
        FROM item_attributes ia
        WHERE ia.attribute_id = ${attributeId}
          AND ${cond}
        GROUP BY ia.item_id
      ) ${alias} ON ${alias}.item_id = i.id
    `);
    params.push(...localParams);
  }

  const join = joins.join('\n');
  return { join, params };
}

// ------------------- health & seed -------------------
app.get('/health', async () => ({ ok: true }));
app.get('/_db-ping', async () => { const [rows] = await db.query('SELECT 1 AS ok'); return rows; });

app.post('/_seed-admin', async (req: any, reply: any) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password) return reply.code(400).send({ message: 'email y password requeridos' });
    const hash = await bcrypt.hash(password, 10);
    const [result]: any = await db.execute(
      `INSERT INTO users (email, password_hash, display_name, is_active) VALUES (?,?,?,1)`,
      [email, hash, displayName || 'Admin']
    );
    const [roleRows]: any = await db.execute(
      'SELECT TOP 1 id FROM roles WHERE name = ?',
      ['admin']
    );
    if (roleRows.length) {
      // SQL SERVER: sin INSERT IGNORE
      await db.execute(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [result.insertId, roleRows[0].id]
      );
    }
    reply.send({ ok: true, userId: result.insertId, email });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

// ------------------- auth -------------------
app.post('/auth/login', async (req: any, reply: any) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return reply.code(400).send({ message: 'email y password requeridos' });

    const [rows]: any = await db.execute(
      `SELECT TOP 1 id, email, password_hash AS passwordHash, display_name AS displayName, is_active AS isActive
         FROM users WHERE email = ?`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.isActive) return reply.code(401).send({ message: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ message: 'Credenciales inválidas' });

    const [roleRows]: any = await db.execute(
      `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?`,
      [user.id]
    );
    const roles: string[] = roleRows.map((r: any) => r.name);

    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, name: user.displayName, roles },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '15m' }
    );

    const refreshToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.execute(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at)
       VALUES (NEWID(), ?, ?, ?)`,
      [user.id, refreshToken, expiresAt]
    );

    reply.send({ user: { id: user.id, email: user.email, displayName: user.displayName, roles }, accessToken, refreshToken });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.post('/auth/logout', async (req: any, reply: any) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return reply.code(400).send({ message: 'refreshToken requerido' });
    await db.execute(`UPDATE refresh_tokens SET revoked = 1 WHERE token = ?`, [refreshToken]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.post('/auth/forgot-password', async (req: any, reply: any) => {
  try {
    const { email } = req.body || {};
    if (!email) return reply.code(400).send({ message: 'email requerido' });

    const [rows]: any = await db.execute(
      'SELECT TOP 1 id FROM users WHERE email = ?',
      [email]
    );
    const user = rows[0];
    if (!user) return reply.send({ ok: true, message: 'Si existe, se envió un correo' });

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.execute(
      `INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
       VALUES (NEWID(), ?, ?, ?, 0)`,
      [user.id, token, expiresAt]
    );

    const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:4200';
    const resetLink = `${appUrl}/reset-password?token=${token}`;
    reply.send({ ok: true, resetLink, expiresAt });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.post('/auth/reset-password', async (req: any, reply: any) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return reply.code(400).send({ message: 'token y newPassword requeridos' });

    const [rows]: any = await db.execute(
      `SELECT TOP 1 prt.user_id AS userId, prt.used, prt.expires_at AS expiresAt
         FROM password_reset_tokens prt WHERE prt.token = ?`,
      [token]
    );
    const row = rows[0];
    if (!row || row.used || new Date(row.expiresAt) <= new Date()) {
      return reply.code(400).send({ message: 'TOKEN_INVALIDO' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.userId]);
    await db.execute('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', [token]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

// ------------------- roles & users -------------------
app.get('/roles', async (_req: any, reply: any) => {
  try {
    const [rows]: any = await db.execute(
      'SELECT id, name, description FROM roles ORDER BY id ASC'
    );
    reply.send(rows);
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.post('/roles', async (req: any, reply: any) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return reply.code(400).send({ message: 'name requerido' });
    const [r]: any = await db.execute(
      'INSERT INTO roles (name, description) VALUES (?, ?)',
      [name, description || null]
    );
    reply.send({ id: r.insertId, name, description: description || null });
  } catch (e:any) {
    // TODO: ajustar manejo de error duplicado para SQL Server si quieres
    reply.code(500).send({ message: e.message });
  }
});

app.post('/roles/assign', async (req: any, reply: any) => {
  try {
    const { userId, roleId } = req.body || {};
    if (!userId || !roleId) return reply.code(400).send({ message: 'userId y roleId requeridos' });
    await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.put('/roles/:id', async (req: any, reply: any) => {
  try {
    const id = Number(req.params.id);
    const { name, description } = req.body || {};
    if (!id || (!name && !description)) return reply.code(400).send({ message: 'datos inválidos' });

    if (name) {
      const [dup]: any = await db.execute(
        'SELECT id FROM roles WHERE name = ? AND id <> ?',
        [name, id]
      );
      if (dup.length) return reply.code(409).send({ message: 'rol ya existe' });
    }
    await db.execute(
      'UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
      [name ?? null, description ?? null, id]
    );
    const [rows]: any = await db.execute(
      'SELECT id, name, description FROM roles WHERE id = ?',
      [id]
    );
    if (!rows[0]) return reply.code(404).send({ message: 'rol no encontrado' });
    reply.send(rows[0]);
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.delete('/roles/:id', async (req: any, reply: any) => {
  try {
    const id = Number(req.params.id);
    if (!id) return reply.code(400).send({ message: 'id inválido' });
    await db.execute('DELETE FROM roles WHERE id = ?', [id]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.get('/users', async (_req: any, reply: any) => {
  try {
    const [rows]: any = await db.execute(
      'SELECT id, email, display_name FROM users ORDER BY id ASC'
    );
    reply.send(rows);
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.get('/roles/of/:userId', async (req: any, reply: any) => {
  try {
    const userId = Number(req.params.userId);
    const [rows]: any = await db.execute(
      `SELECT r.id, r.name, r.description
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ? ORDER BY r.name ASC`,
      [userId]
    );
    reply.send(rows);
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

app.post('/roles/unassign', async (req: any, reply: any) => {
  try {
    const { userId, roleId } = req.body || {};
    if (!userId || !roleId) return reply.code(400).send({ message: 'userId y roleId requeridos' });
    await db.execute('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [userId, roleId]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e.message }); }
});

// ------------------- auth guard -------------------
function authGuard(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
  try {
    const auth = (req.headers as any)?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return reply.code(401).send({ message: 'unauthorized' });
    const payload = (jwt as any).verify(token, process.env.JWT_SECRET as string);
    (req as any).user = payload;
    done();
  } catch {
    reply.code(401).send({ message: 'unauthorized' });
  }
}



// app.post('/items', { preHandler: authGuard }, async (req: any, reply: any) => {
//   try {
//     const ownerId = ensureAuth(req);

//     const ct = String((req.headers['content-type'] || '')).toLowerCase();
//     const isMultipart = ct.startsWith('multipart/form-data');

//     let meta: any = null;
//     const files: { buffer: Buffer; filename: string; mime: string }[] = [];

//     if (isMultipart) {
//       const parts = await (req.parts?.() as AsyncIterable<any>);
//       if (!parts) return reply.code(400).send({ message: 'multipart requerido' });

//       const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
//       const maxImages = 12;

//       for await (const p of parts) {
//         if (p?.type === 'field' && p.fieldname === 'metadata') {
//           try {
//             meta = JSON.parse(String(p.value ?? '{}'));
//           } catch {
//             return reply.code(400).send({ message: 'metadata inválido (JSON)' });
//           }
//           continue;
//         }

//         if (p?.type === 'file') {
//           if (files.length >= maxImages) {
//             await p.file?.resume?.();
//             continue;
//           }

//           const buf = await p.toBuffer();
//           if (!buf?.length) continue;

//           const mime = String(p.mimetype ?? '');
//           if (!allowed.has(mime)) {
//             return reply.code(400).send({ message: 'Formato no soportado' });
//           }

//           files.push({
//             buffer: buf,
//             filename: String(p.filename ?? 'image'),
//             mime,
//           });
//         }
//       }
//     } else {
//       meta = req.body;
//     }

//     if (!meta?.title?.trim()) {
//       return reply.code(400).send({ message: 'metadata.title requerido' });
//     }

//     // ========= INSERT + ID (robusto para cualquier driver) =========
//     const [idRows]: any = await db.execute(
//       `
//       SET NOCOUNT ON;

//       DECLARE @t TABLE (id BIGINT);

//       INSERT INTO philatelic_items (
//         owner_user_id,
//         title,
//         description,
//         country,
//         issue_year,
//         condition_code,
//         catalog_code,
//         face_value,
//         currency,
//         acquisition_date,
//         visibility,
//         created_at,
//         updated_at
//       )
//       OUTPUT INSERTED.id INTO @t(id)
//       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME());

//       SELECT TOP (1) id FROM @t;
//       `,
//       [
//         ownerId,
//         meta.title.trim(),
//         meta.description || null,
//         meta.country || null,
//         meta.issueYear ?? meta.issue_year ?? meta.year ?? null,
//         meta.condition ?? meta.condition_code ?? null,
//         meta.catalogCode ?? meta.catalog_code ?? null,
//         meta.faceValue ?? meta.face_value ?? null,
//         meta.currency ?? null,
//         meta.acquisitionDate ?? meta.acquisition_date ?? null,
//         meta.visibility || 'public',
//       ]
//     );

//     // depende del wrapper: a veces viene como [ [ {id: ...} ] , ...]
//     const row0 = Array.isArray(idRows) ? idRows[0] : null;
//     const itemId = Number(row0?.id);

//     if (!Number.isFinite(itemId)) {
//       throw new Error('No se pudo obtener el id insertado');
//     }
//     // ===============================================================

//     // ================= IMÁGENES =================
//     if (files.length) {
//       const fs = require('fs');
//       const path = require('path');

//       const base = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');
//       if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });

//       for (const [i, f] of files.entries()) {
//         const filePath = path.join(
//           base,
//           `${itemId}-${Date.now()}-${i}-${f.filename}`.replace(/[^\w.\-]+/g, '_')
//         );
//         fs.writeFileSync(filePath, f.buffer);
//         await db.execute(
//           `
//           INSERT INTO item_images (item_id, file_path, is_primary)
//           VALUES (?, ?, ?);
//           `,
//           [itemId, filePath, i === 0 ? 1 : 0]
//         );
//       }
//     }

//     return reply.code(201).send({ id: itemId, message: 'item_creado' });
//   } catch (e: any) {
//     console.error('[POST /items] ERROR:', e);
//     return reply.code(500).send({
//       message: 'Ha ocurrido un error, por favor contactar con soporte',
//       detail: String(e?.message || ''),
//     });
//   }
// });




// GET /me/items

app.post('/items', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);

    const ct = String((req.headers['content-type'] || '')).toLowerCase();
    const isMultipart = ct.startsWith('multipart/form-data');

    let meta: any = null;
    const files: { buffer: Buffer; filename: string; mime: string }[] = [];

    if (isMultipart) {
      const parts = await (req.parts?.() as AsyncIterable<any>);
      if (!parts) return reply.code(400).send({ message: 'multipart requerido' });

      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
      const maxImages = 12;

      for await (const p of parts) {
        if (p?.type === 'field' && p.fieldname === 'metadata') {
          try {
            meta = JSON.parse(String(p.value ?? '{}'));
          } catch {
            return reply.code(400).send({ message: 'metadata inválido (JSON)' });
          }
          continue;
        }

        if (p?.type === 'file') {
          if (files.length >= maxImages) {
            await p.file?.resume?.();
            continue;
          }
          const buf = await p.toBuffer();
          if (!buf?.length) continue;

          const mime = String(p.mimetype ?? '');
          if (!allowed.has(mime)) return reply.code(400).send({ message: 'Formato no soportado' });

          files.push({ buffer: buf, filename: String(p.filename ?? 'image'), mime });
        }
      }
    } else {
      meta = req.body;
    }

    if (!meta?.title?.trim()) {
      return reply.code(400).send({ message: 'metadata.title requerido' });
    }

    // ✅ IMPORTANTÍSIMO: tu front manda tags + categories
    const tagsJson = JSON.stringify(meta?.tags ?? []);
    const attrsJson = JSON.stringify(meta?.categories ?? meta?.attributes ?? meta?.attrs ?? []);

    // ========== INSERT item + tags + attrs (SQL Server) ==========
    const [idRows]: any = await db.execute(
      `
      SET NOCOUNT ON;
      BEGIN TRY
        BEGIN TRAN;

        DECLARE @ownerId BIGINT = ?;
        DECLARE @title VARCHAR(200) = ?;
        DECLARE @description NVARCHAR(MAX) = ?;
        DECLARE @country VARCHAR(80) = ?;
        DECLARE @issue_year SMALLINT = ?;
        DECLARE @condition_code VARCHAR(30) = ?;
        DECLARE @catalog_code VARCHAR(80) = ?;
        DECLARE @face_value DECIMAL(10,2) = ?;
        DECLARE @currency VARCHAR(10) = ?;
        DECLARE @acquisition_date DATE = ?;
        DECLARE @visibility VARCHAR(10) = ?;

        DECLARE @tagsJson NVARCHAR(MAX) = ?;   -- JSON array
        DECLARE @attrsJson NVARCHAR(MAX) = ?;  -- JSON array

        DECLARE @t TABLE (id BIGINT);

        INSERT INTO philatelic_items (
          owner_user_id, title, description, country, issue_year,
          condition_code, catalog_code, face_value, currency,
          acquisition_date, visibility, created_at, updated_at
        )
        OUTPUT INSERTED.id INTO @t(id)
        VALUES (
          @ownerId, @title, @description, @country, @issue_year,
          @condition_code, @catalog_code, @face_value, @currency,
          @acquisition_date, @visibility, SYSUTCDATETIME(), SYSUTCDATETIME()
        );

        DECLARE @itemId BIGINT = (SELECT TOP (1) id FROM @t);

        ------------------------------------------------------------------
        -- TAGS (robusto):
        -- - soporta: ["a","b"], [1,2], [{"id":1}], [{"name":"a"}]
        -- - NO usa JSON_VALUE sobre strings sueltas
        ------------------------------------------------------------------
        IF (ISJSON(@tagsJson) = 1)
        BEGIN
          DECLARE @tagIds TABLE (tag_id INT PRIMARY KEY);
          DECLARE @tagNames TABLE (name VARCHAR(60) PRIMARY KEY);

          -- (A) ids escalares: [1,2,3]
          INSERT INTO @tagIds(tag_id)
          SELECT DISTINCT TRY_CAST([value] AS INT)
          FROM OPENJSON(@tagsJson)
          WHERE TRY_CAST([value] AS INT) IS NOT NULL;

          -- (B) objetos: [{"id":1,"name":"x"}] (WITH NO explota con escalares)
          ;WITH O AS (
            SELECT
              id   = TRY_CAST(id AS INT),
              name = NULLIF(LTRIM(RTRIM(name)), '')
            FROM OPENJSON(@tagsJson)
            WITH (
              id   NVARCHAR(50) '$.id',
              name NVARCHAR(60) '$.name'
            )
          )
          INSERT INTO @tagIds(tag_id)
          SELECT DISTINCT id FROM O WHERE id IS NOT NULL;

          INSERT INTO @tagNames(name)
          SELECT DISTINCT LEFT(name, 60) FROM O WHERE name IS NOT NULL;

          -- (C) strings escalares: ["alskdn","dasd"]  -> OPENJSON retorna value ya sin comillas
          INSERT INTO @tagNames(name)
          SELECT DISTINCT LEFT(LTRIM(RTRIM([value])), 60)
          FROM OPENJSON(@tagsJson)
          WHERE TRY_CAST([value] AS INT) IS NULL
            AND NULLIF(LTRIM(RTRIM([value])), '') IS NOT NULL;

          -- crea tags faltantes (por owner)
          MERGE tags AS T
          USING (SELECT name FROM @tagNames) AS S
            ON T.owner_user_id = @ownerId AND T.name = S.name
          WHEN NOT MATCHED THEN
            INSERT (owner_user_id, name) VALUES (@ownerId, S.name);

          -- inserta relaciones por ids directos
          INSERT INTO item_tags (item_id, tag_id)
          SELECT @itemId, tag_id
          FROM @tagIds;

          -- inserta relaciones por nombres (resuelve a id)
          INSERT INTO item_tags (item_id, tag_id)
          SELECT DISTINCT @itemId, TT.id
          FROM tags TT
          JOIN @tagNames N ON N.name = TT.name
          WHERE TT.owner_user_id = @ownerId
            AND NOT EXISTS (
              SELECT 1 FROM item_tags IT WHERE IT.item_id = @itemId AND IT.tag_id = TT.id
            );
        END

        ------------------------------------------------------------------
        -- ATTRS (tu front manda "categories"):
        -- [{name:"Aaa", attrType:"text", value:"AAA"}]
        -- guarda en attribute_definitions + item_attributes
        ------------------------------------------------------------------
        IF (ISJSON(@attrsJson) = 1)
        BEGIN
          ;WITH A AS (
            SELECT
              attribute_id = TRY_CAST(attributeId AS INT),
              name         = NULLIF(LTRIM(RTRIM(name)), ''),
              attr_type    = LOWER(NULLIF(LTRIM(RTRIM(attrType)), '')),
              value_raw    = NULLIF(value, '')
            FROM OPENJSON(@attrsJson)
            WITH (
              attributeId NVARCHAR(50) '$.attributeId',
              name        NVARCHAR(100) '$.name',
              attrType    NVARCHAR(10)  '$.attrType',
              value       NVARCHAR(MAX) '$.value'
            )
          ),
          NAMES AS (
            SELECT DISTINCT
              name,
              CASE WHEN attr_type IN ('text','number','date','list') THEN attr_type ELSE 'text' END AS attr_type
            FROM A
            WHERE name IS NOT NULL
          )
          -- crea definiciones faltantes
          MERGE attribute_definitions AS D
          USING NAMES AS S
            ON D.owner_user_id = @ownerId AND D.name = S.name
          WHEN NOT MATCHED THEN
            INSERT (owner_user_id, name, attr_type, options_json, created_at)
            VALUES (@ownerId, S.name, S.attr_type, NULL, SYSUTCDATETIME());

          -- inserta valores (resolve attribute_id por id o por name)
          INSERT INTO item_attributes (item_id, attribute_id, value_text, value_number, value_date)
          SELECT
            @itemId,
            COALESCE(A.attribute_id, D.id) AS attribute_id,
            CASE WHEN COALESCE(A.attr_type, D.attr_type) IN ('text','list') THEN A.value_raw ELSE NULL END,
            CASE WHEN COALESCE(A.attr_type, D.attr_type) = 'number' THEN TRY_CONVERT(DECIMAL(18,6), A.value_raw) ELSE NULL END,
            CASE WHEN COALESCE(A.attr_type, D.attr_type) = 'date'   THEN TRY_CONVERT(DATE, A.value_raw) ELSE NULL END
          FROM A
          LEFT JOIN attribute_definitions D
            ON D.owner_user_id = @ownerId AND D.name = A.name
          WHERE COALESCE(A.attribute_id, D.id) IS NOT NULL
            AND A.value_raw IS NOT NULL;
        END

        COMMIT;
        SELECT @itemId AS id;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
      END CATCH
      `,
      [
        ownerId,
        meta.title.trim(),
        meta.description || null,
        meta.country || null,
        meta.issueYear ?? meta.issue_year ?? meta.year ?? null,
        meta.condition ?? meta.condition_code ?? null,
        meta.catalogCode ?? meta.catalog_code ?? null,
        meta.faceValue ?? meta.face_value ?? null,
        meta.currency ?? null,
        meta.acquisitionDate ?? meta.acquisition_date ?? null,
        meta.visibility || 'public',
        tagsJson,
        attrsJson,
      ]
    );

    const row0 = Array.isArray(idRows) ? idRows[0] : null;
    const itemId = Number(row0?.id);
    if (!Number.isFinite(itemId)) throw new Error('No se pudo obtener el id insertado');

    // ===== IMÁGENES (igual que tú) =====
    if (files.length) {
      const fs = require('fs');
      const path = require('path');

      const base = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });

      for (const [i, f] of files.entries()) {
        const filePath = path.join(
          base,
          `${itemId}-${Date.now()}-${i}-${f.filename}`.replace(/[^\w.\-]+/g, '_')
        );
        fs.writeFileSync(filePath, f.buffer);

        await db.execute(
          `INSERT INTO item_images (item_id, file_path, is_primary) VALUES (?, ?, ?);`,
          [itemId, filePath, i === 0 ? 1 : 0]
        );
      }
    }

    return reply.code(201).send({ id: itemId, message: 'item_creado' });
  } catch (e: any) {
    console.error('[POST /items] ERROR:', e);
    return reply.code(500).send({
      message: 'Ha ocurrido un error, por favor contactar con soporte',
      detail: String(e?.message || ''),
    });
  }
});



app.get('/me/items', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const q: any = req.query || {};
    const offset = Number.isFinite(Number(q.offset)) && Number(q.offset) >= 0 ? Number(q.offset) : 0;
    const limit  = Number.isFinite(Number(q.limit))  && Number(q.limit)  >  0 ? Number(q.limit)  : 20;
    const orderParam = String(q.order || '').toLowerCase();
    const orderSql = orderParam === 'created_at_asc' ? 'i.created_at ASC' : 'i.created_at DESC';

    const ownerId = ensureAuth(req);
    const sql = `
      SELECT i.id,
             i.title,
             i.country,
             i.issue_year AS issueYear,
             (
               SELECT TOP 1 file_path
               FROM item_images
               WHERE item_id = i.id
               ORDER BY is_primary DESC, id ASC
             ) AS cover
      FROM philatelic_items i
      WHERE i.owner_user_id = ?
      ORDER BY ${orderSql}
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    // const [rows]: any = await db.execute(sql, [ownerId]);
    // const out = rows.map((r: any) => ({ ...r, cover: toPublicUrl(r.cover) }));
    // reply.send(out);
    const [rows]: any = await db.execute(sql, [ownerId]);

const out = rows.map((r: any) => {
  const webPath  = toPublicUrl(r.cover);          // "/uploads/9-....png"
  const fullUrl  = toAbsoluteUrl(webPath);        // "https://TU-API.../uploads/9-....png"
  return { ...r, cover: fullUrl };
});

reply.send(out);

  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});



// app.get('/items/search', { preHandler: authGuard }, async (req: any, reply: any) => {
//   try {
//     const ownerId = ensureAuth(req);
//     const q: any = req.query || {};
//     const attrs = parseJsonSafely(q.attrs, undefined);

//     const f = {
//       q: q.q,
//       country: q.country,
//       condition: q.condition,
//       yearFrom: q.yearFrom ? Number(q.yearFrom) : undefined,
//       yearTo:   q.yearTo   ? Number(q.yearTo)   : undefined,
//       tagIds: Array.isArray(q.tagIds) ? q.tagIds : (q.tagIds ? [q.tagIds] : []),
//       tagNames: Array.isArray(q.tagNames) ? q.tagNames : (q.tagNames ? [q.tagNames] : []),
//       tagsMode: q.tagsMode,
//       attrs
//     };

//     const {
//       where,
//       params: whereParams,
//       tagIds,
//       tagNames,
//       tagMode,
//       attrFilters
//     } = buildWhereFromFilter(ownerId, f);

//     let join = '';
//     const joinParams: any[] = [];

//     if ((tagIds.length + tagNames.length) > 0) {
//       let allTagIds = [...tagIds];

//       if (tagNames.length) {
//         const placeholders = tagNames.map(() => '?').join(',');
//         const ownerFilter = await tagsOwnerWhere(ownerId);
//         const [trs]: any = await db.execute(
//           `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
//           [...ownerFilter.params, ...tagNames]
//         );
//         allTagIds = allTagIds.concat(trs.map((r: any) => r.id));
//       }

//       const uniqueIds = Array.from(
//         new Set(allTagIds.map(Number).filter(Number.isFinite))
//       );

//       if (uniqueIds.length) {
//         if (tagMode === 'AND') {
//           join += `
//             JOIN (
//               SELECT it.item_id
//               FROM item_tags it
//               WHERE it.tag_id IN (${uniqueIds.map(() => '?').join(',')})
//               GROUP BY it.item_id
//               HAVING COUNT(DISTINCT it.tag_id) = ${uniqueIds.length}
//             ) tfilter ON tfilter.item_id = i.id`;
//           joinParams.push(...uniqueIds);
//         } else {
//           join += `
//             JOIN item_tags itf
//               ON itf.item_id = i.id
//              AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})`;
//           joinParams.push(...uniqueIds);
//         }
//       }
//     }

//     const { join: attrJoin, params: attrParams } = await buildAttrJoins(ownerId, attrFilters);
//     join += attrJoin;
//     joinParams.push(...attrParams);

//     const offset =
//       Number.isFinite(Number(q.offset)) && Number(q.offset) >= 0
//         ? Number(q.offset)
//         : 0;
//     const limit =
//       Number.isFinite(Number(q.limit)) && Number(q.limit) > 0
//         ? Number(q.limit)
//         : 20;

//     const sql = `
//       SELECT DISTINCT
//         i.id,
//         i.title,
//         i.country,
//         i.issue_year AS issueYear,
//         i.created_at AS createdAt,
//         (
//           SELECT TOP 1 file_path
//           FROM item_images
//           WHERE item_id = i.id
//           ORDER BY is_primary DESC, id ASC
//         ) AS cover
//       FROM philatelic_items i
//       ${join}
//       WHERE ${where.join(' AND ')}
//       ORDER BY createdAt DESC
//       OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

//     const [rows]: any = await db.execute(sql, [...joinParams, ...whereParams]);

//     // 🔹 normaliza la URL de cover
//     const out = rows.map((r: any) => {
//       const rel = toPublicUrl(r.cover);   // "/uploads/..."
//       const abs = toAbsoluteUrl(rel);     // "https://filatelia-api.../uploads/..."
//       return {
//         ...r,
//         cover: abs || rel,
//       };
//     });

//     reply.send(out);
//   } catch (e: any) {
//     if (e.message === 'UNAUTHORIZED') {
//       return reply.code(401).send({ message: 'unauthorized' });
//     }
//     reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
//   }
// });


app.get('/items/search', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const q: any = req.query || {};
    const attrs = parseJsonSafely(q.attrs, undefined);

    const f = {
      q: q.q,
      country: q.country,
      condition: q.condition,
      yearFrom: q.yearFrom ? Number(q.yearFrom) : undefined,
      yearTo:   q.yearTo   ? Number(q.yearTo)   : undefined,
      tagIds: Array.isArray(q.tagIds) ? q.tagIds : (q.tagIds ? [q.tagIds] : []),
      tagNames: Array.isArray(q.tagNames) ? q.tagNames : (q.tagNames ? [q.tagNames] : []),
      tagsMode: q.tagsMode,
      attrs
    };

    const {
      where,
      params: whereParams,
      tagIds,
      tagNames,
      tagMode,
      attrFilters
    } = buildWhereFromFilter(ownerId, f);

    let join = '';
    const joinParams: any[] = [];

    // ---------------- TAG FILTER (igual que ya lo tienes)
    if ((tagIds.length + tagNames.length) > 0) {
      let allTagIds = [...tagIds];

      if (tagNames.length) {
        const placeholders = tagNames.map(() => '?').join(',');
        const ownerFilter = await tagsOwnerWhere(ownerId);
        const [trs]: any = await db.execute(
          `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
          [...ownerFilter.params, ...tagNames]
        );
        allTagIds = allTagIds.concat(trs.map((r: any) => r.id));
      }

      const uniqueIds = Array.from(
        new Set(allTagIds.map(Number).filter(Number.isFinite))
      );

      if (uniqueIds.length) {
        if (tagMode === 'AND') {
          join += `
            JOIN (
              SELECT it.item_id
              FROM item_tags it
              WHERE it.tag_id IN (${uniqueIds.map(() => '?').join(',')})
              GROUP BY it.item_id
              HAVING COUNT(DISTINCT it.tag_id) = ${uniqueIds.length}
            ) tfilter ON tfilter.item_id = i.id`;
          joinParams.push(...uniqueIds);
        } else {
          join += `
            JOIN item_tags itf
              ON itf.item_id = i.id
             AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})`;
          joinParams.push(...uniqueIds);
        }
      }
    }

    // ---------------- ATTR FILTER JOIN (igual que ya lo tienes)
    const { join: attrJoin, params: attrParams } = await buildAttrJoins(ownerId, attrFilters);
    join += attrJoin;
    joinParams.push(...attrParams);

    const offset =
      Number.isFinite(Number(q.offset)) && Number(q.offset) >= 0
        ? Number(q.offset)
        : 0;

    const limit =
      Number.isFinite(Number(q.limit)) && Number(q.limit) > 0
        ? Number(q.limit)
        : 20;

    // ✅ AHORA: además de cover, devolvemos tags + attrs (como JSON)
    const sql = `
      SELECT DISTINCT
        i.id,
        i.title,
        i.country,
        i.issue_year AS issueYear,
        i.created_at AS createdAt,
        (
          SELECT TOP 1 file_path
          FROM item_images
          WHERE item_id = i.id
          ORDER BY is_primary DESC, id ASC
        ) AS cover,

        -- ✅ TAGS del item (array JSON)
        COALESCE(
          (
            SELECT
              '[' + STRING_AGG('"' + REPLACE(t.name, '"', '\\"') + '"', ',') + ']'
            FROM item_tags it
            JOIN tags t ON t.id = it.tag_id
            WHERE it.item_id = i.id
          ),
          '[]'
        ) AS tagsJson,

        -- ✅ ATRIBUTOS dinámicos del item (array JSON)
        COALESCE(
          (
            SELECT
              ad.name AS [name],
              COALESCE(
                ia.value_text,
                CAST(ia.value_number AS VARCHAR(50)),
                CONVERT(VARCHAR(10), ia.value_date, 23)
              ) AS [value]
            FROM item_attributes ia
            JOIN attribute_definitions ad
              ON ad.id = ia.attribute_id
            WHERE ia.item_id = i.id
            FOR JSON PATH
          ),
          '[]'
        ) AS attrsJson

      FROM philatelic_items i
      ${join}
      WHERE ${where.join(' AND ')}
      ORDER BY createdAt DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;

    const [rows]: any = await db.execute(sql, [...joinParams, ...whereParams]);

    // 🔹 normaliza cover + parsea JSON de tags/attrs
    const out = rows.map((r: any) => {
      const rel = toPublicUrl(r.cover);   // "/uploads/..."
      const abs = toAbsoluteUrl(rel);     // "https://filatelia-api.../uploads/..."

      let tags: string[] = [];
      let attrsOut: { name: string; value: string }[] = [];

      try { tags = JSON.parse(r.tagsJson || '[]'); } catch {}
      try { attrsOut = JSON.parse(r.attrsJson || '[]'); } catch {}

      return {
        id: r.id,
        title: r.title,
        country: r.country,
        issueYear: r.issueYear,
        createdAt: r.createdAt,
        cover: abs || rel,

        // ✅ nuevos campos para el frontend
        tags,
        attrs: attrsOut
      };
    });

    reply.send(out);
  } catch (e: any) {
    if (e.message === 'UNAUTHORIZED') {
      return reply.code(401).send({ message: 'unauthorized' });
    }
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


// app.get('/items/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
//   try {
//     const ownerId = ensureAuth(req);
//     const itemId = Number(req.params.id);
//     if (!Number.isFinite(itemId)) return reply.code(400).send({ message: 'id inválido' });

//     const [rows]: any = await db.execute(
//       `SELECT *
//          FROM philatelic_items
//         WHERE id = ? AND owner_user_id = ?`,
//       [itemId, ownerId]
//     );
//     const item = rows?.[0];
//     if (!item) return reply.code(404).send({ message: 'not_found' });

//     const [imgRows]: any = await db.execute(
//       `SELECT id,
//              file_path AS [file], 
//              is_primary AS [primary]
//          FROM item_images
//         WHERE item_id = ?
//         ORDER BY is_primary DESC, id ASC`,
//       [itemId]
//     );

//     // 🔹 aquí el cambio
//     item.images = (imgRows || []).map((im: any) => {
//       const rel = toPublicUrl(im.file);   // "/uploads/..."
//       const abs = toAbsoluteUrl(rel);     // "https://filatelia-api.../uploads/..."
//       return {
//         ...im,
//         file: abs || rel,
//       };
//     });

//     // opcional: normalizar cover si existe
//     if (item.cover) {
//       const relCover = toPublicUrl(item.cover);
//       const absCover = toAbsoluteUrl(relCover);
//       item.cover = absCover || relCover;
//     }

//     reply.send(item);
//   } catch (e: any) {
//     reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
//   }
// });

app.get('/items/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) return reply.code(400).send({ message: 'id inválido' });

    // 1) ITEM
    const [rows]: any = await db.execute(
      `SELECT *
         FROM philatelic_items
        WHERE id = ? AND owner_user_id = ?`,
      [itemId, ownerId]
    );
    const item = rows?.[0];
    if (!item) return reply.code(404).send({ message: 'not_found' });

    // 2) IMÁGENES
    const [imgRows]: any = await db.execute(
      `SELECT id,
             file_path AS [file],
             is_primary AS [primary]
         FROM item_images
        WHERE item_id = ?
        ORDER BY is_primary DESC, id ASC`,
      [itemId]
    );

    item.images = (imgRows || []).map((im: any) => {
      const rel = toPublicUrl(im.file);
      const abs = toAbsoluteUrl(rel);
      return { ...im, file: abs || rel };
    });

    if (item.cover) {
      const relCover = toPublicUrl(item.cover);
      const absCover = toAbsoluteUrl(relCover);
      item.cover = absCover || relCover;
    }

    // 3) TAGS (item_tags -> tags)
    const [tagRows]: any = await db.execute(
      `
      SELECT t.id, t.name
      FROM item_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = ? AND t.owner_user_id = ?
      ORDER BY t.name ASC;
      `,
      [itemId, ownerId]
    );
    item.tags = (tagRows || []).map((t: any) => ({ id: t.id, name: t.name }));

    // 4) ATTRIBUTES (item_attributes -> attribute_definitions)
    const [attrRows]: any = await db.execute(
      `
      SELECT
        ia.attribute_id        AS attributeId,
        ad.name                AS name,
        ad.attr_type           AS type,
        ia.value_text          AS valueText,
        ia.value_number        AS valueNumber,
        ia.value_date          AS valueDate
      FROM item_attributes ia
      JOIN attribute_definitions ad ON ad.id = ia.attribute_id
      WHERE ia.item_id = ? AND ad.owner_user_id = ?
      ORDER BY ad.name ASC;
      `,
      [itemId, ownerId]
    );

    item.attributes = (attrRows || []).map((a: any) => ({
      attributeId: a.attributeId,
      name: a.name,
      type: a.type,
      valueText: a.valueText ?? null,
      valueNumber: a.valueNumber ?? null,
      valueDate: a.valueDate ?? null,
    }));

    return reply.send(item);
  } catch (e: any) {
    console.error('[GET /items/:id] ERROR:', e);
    return reply
      .code(500)
      .send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});



app.put('/items/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });
    const { title, description, country, issueYear, condition, catalogCode, faceValue, currency, acquisitionDate } = req.body || {};
    const [r]: any = await db.execute(
      `UPDATE philatelic_items
          SET title = COALESCE(?, title),
              description = COALESCE(?, description),
              country = COALESCE(?, country),
              issue_year = COALESCE(?, issue_year),
              condition_code = COALESCE(?, condition_code),
              catalog_code = COALESCE(?, catalog_code),
              face_value = COALESCE(?, face_value),
              currency = COALESCE(?, currency),
              acquisition_date = COALESCE(?, acquisition_date)
        WHERE id = ? AND owner_user_id = ?`,
      [title ?? null, description ?? null, country ?? null, issueYear ?? null, condition ?? null,
       catalogCode ?? null, faceValue ?? null, currency ?? null, acquisitionDate ?? null, id, ownerId]
    );
    if (r.affectedRows === 0) return reply.code(404).send({ message: 'not_found' });
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.delete('/items/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const [imgs]: any = await db.execute(
      'SELECT id, file_path FROM item_images WHERE item_id = ?',
      [id]
    );
    await db.execute('DELETE FROM item_images WHERE item_id = ?', [id]);
    await db.execute('DELETE FROM item_attributes WHERE item_id = ?', [id]);
    await db.execute('DELETE FROM item_tags WHERE item_id = ?', [id]);
    const [r]: any = await db.execute(
      'DELETE FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [id, ownerId]
    );

    try {
      const fs = require('fs');
      for (const im of imgs || []) {
        if (im?.file_path && fs.existsSync(im.file_path)) {
          try { fs.unlinkSync(im.file_path); } catch {}
        }
      }
    } catch {}

    if (r.affectedRows === 0) return reply.code(404).send({ message: 'not_found' });
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

// ------------------- TAGS -------------------
app.post('/tags', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const { name } = req.body || {};
    if (!name) return reply.code(400).send({ message: 'name requerido' });

    const haveOwner = await hasColumn('tags', 'owner_user_id');
    const ownerFilter = await tagsOwnerWhere(ownerId);

    const [dup]: any = await db.execute(
      `SELECT TOP 1 id FROM tags WHERE ${ownerFilter.where} AND name = ?`,
      [...ownerFilter.params, name]
    );
    if (dup.length) return reply.code(409).send({ message: 'tag ya existe' });

    const [r]: any = await db.execute(
      haveOwner ? `INSERT INTO tags (name, owner_user_id) VALUES (?,?)`
                : `INSERT INTO tags (name) VALUES (?)`,
      haveOwner ? [name, ownerId] : [name]
    );
    reply.send({ id: r.insertId, name });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.get('/tags', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const ownerFilter = await tagsOwnerWhere(ownerId);
    const [rows]: any = await db.execute(
      `SELECT id, name
         FROM tags
        WHERE ${ownerFilter.where}
        ORDER BY name ASC`,
      ownerFilter.params
    );
    reply.send(rows);
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.delete('/tags/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    await db.execute('DELETE FROM item_tags WHERE tag_id = ?', [id]);
    await db.execute('DELETE FROM tags WHERE id = ?', [id]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.post('/items/:id/tags', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) return reply.code(400).send({ message: 'itemId inválido' });

    const [it]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemId, ownerId]
    );
    if (!it.length) return reply.code(404).send({ message: 'item_not_found' });

    const { tagIds = [], tagNames = [] } = req.body || {};
    const haveOwner = await hasColumn('tags', 'owner_user_id');
    const ownerFilter = await tagsOwnerWhere(ownerId);

    let ids: number[] = Array.isArray(tagIds) ? tagIds.map((x: any) => Number(x)).filter(Number.isFinite) : [];

    if (Array.isArray(tagNames) && tagNames.length) {
      const names = tagNames.map((x: any) => String(x).trim()).filter(Boolean);
      if (names.length) {
        const placeholders = names.map(() => '?').join(',');
        const [found]: any = await db.execute(
          `SELECT id, name
             FROM tags
            WHERE ${ownerFilter.where}
              AND name IN (${placeholders})`,
          [...ownerFilter.params, ...names]
        );
        const foundByName = new Map<string, number>();
        for (const r of (found || [])) foundByName.set(r.name, r.id);

        for (const nm of names) {
          if (foundByName.has(nm)) ids.push(foundByName.get(nm)!);
          else {
            const [ins]: any = await db.execute(
              haveOwner ? `INSERT INTO tags (name, owner_user_id) VALUES (?,?)`
                        : `INSERT INTO tags (name) VALUES (?)`,
              haveOwner ? [nm, ownerId] : [nm]
            );
            ids.push(ins.insertId);
          }
        }
      }
    }

    ids = Array.from(new Set(ids));
    for (const tid of ids) {
      await db.execute(
        'INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)',
        [itemId, tid]
      );
    }
    reply.send({ ok: true, added: ids.length });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.delete('/items/:id/tags/:tagId', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    const tagId = Number(req.params.tagId);
    if (!Number.isFinite(itemId) || !Number.isFinite(tagId)) return reply.code(400).send({ message: 'parámetros inválidos' });

    const [it]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemId, ownerId]
    );
    if (!it.length) return reply.code(404).send({ message: 'item_not_found' });

    await db.execute(
      'DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?',
      [itemId, tagId]
    );
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

// ------------------- ATTRIBUTES -------------------
app.post('/attributes', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const { name, attr_type = 'text', options_json } = req.body || {};
    if (!name) return reply.code(400).send({ message: 'name requerido' });

    const [dup]: any = await db.execute(
      `SELECT TOP 1 id
         FROM attribute_definitions
        WHERE owner_user_id = ? AND name = ?`,
      [ownerId, name]
    );
    if (dup.length) return reply.code(409).send({ message: 'attribute ya existe' });

    const [r]: any = await db.execute(
      `INSERT INTO attribute_definitions (owner_user_id, name, attr_type, options_json)
       VALUES (?,?,?,?)`,
      [ownerId, name, ['text','number','date','list'].includes(String(attr_type)) ? attr_type : 'text',
       options_json ? JSON.stringify(options_json) : null]
    );
    reply.send({ id: r.insertId, name, attr_type });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

// app.get('/attributes', { preHandler: authGuard }, async (req: any, reply: any) => {
//   try {
//     const ownerId = ensureAuth(req);
//     const [rows]: any = await db.execute(
//       `SELECT id,
//               name,
//               attr_type AS attrType,
//               options_json AS optionsJson,
//               created_at AS createdAt
//          FROM attribute_definitions
//         WHERE owner_user_id = ?
//         ORDER BY name ASC`,
//       [ownerId]
//     );
//     reply.send(rows);
//   } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
// });

app.get('/attributes', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const [rows]: any = await db.execute(
      `SELECT id,
              name,
              attr_type AS attrType,
              options_json AS optionsJson,
              created_at AS createdAt
         FROM attribute_definitions
        WHERE owner_user_id = ?
        ORDER BY name ASC`,
      [ownerId]
    );

    const safe = (rows || []).map((r: any) => {
      let raw = r.optionsJson;

      // ✅ si viene como Buffer (mysql driver)
      if (raw && typeof raw === 'object' && raw.type === 'Buffer' && Array.isArray(raw.data)) {
        raw = Buffer.from(raw.data).toString('utf8');
      }

      let options: string[] = [];

      // si ya es array
      if (Array.isArray(raw)) {
        options = raw.map((x: any) => String(x).trim()).filter(Boolean);
      }
      // si es string JSON o "A,B,C"
      else if (typeof raw === 'string' && raw.trim()) {
        const s = raw.trim();
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) {
            options = parsed.map((x: any) => String(x).trim()).filter(Boolean);
          } else if (typeof parsed === 'string') {
            // doble-encode: "\"[\"A\",\"B\"]\""
            try {
              const parsed2 = JSON.parse(parsed);
              if (Array.isArray(parsed2)) {
                options = parsed2.map((x: any) => String(x).trim()).filter(Boolean);
              } else {
                options = parsed.split(',').map((x) => x.trim()).filter(Boolean);
              }
            } catch {
              options = parsed.split(',').map((x) => x.trim()).filter(Boolean);
            }
          } else {
            options = s.split(',').map((x) => x.trim()).filter(Boolean);
          }
        } catch {
          options = s.split(',').map((x) => x.trim()).filter(Boolean);
        }
      }

      return {
        id: r.id,
        name: r.name,
        attrType: r.attrType,
        createdAt: r.createdAt,
        options, // ✅ lo que el front necesita
        optionsJson: r.optionsJson, // opcional: para debug
      };
    });

    reply.send(safe);
  } catch (e: any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});



app.put('/attributes/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const { name, attr_type, options_json } = req.body || {};
    const [ex]: any = await db.execute(
      `SELECT TOP 1 id
         FROM attribute_definitions
        WHERE id = ? AND owner_user_id = ?`,
      [id, ownerId]
    );
    if (!ex.length) return reply.code(404).send({ message: 'not_found' });

    if (name) {
      const [dup]: any = await db.execute(
        `SELECT TOP 1 id
           FROM attribute_definitions
          WHERE owner_user_id = ? AND name = ? AND id <> ?`,
        [ownerId, name, id]
      );
      if (dup.length) return reply.code(409).send({ message: 'attribute ya existe' });
    }

    await db.execute(
      `UPDATE attribute_definitions
          SET name = COALESCE(?, name),
              attr_type = COALESCE(?, attr_type),
              options_json = COALESCE(?, options_json)
        WHERE id = ?`,
      [
        name ?? null,
        attr_type && ['text','number','date','list'].includes(String(attr_type)) ? attr_type : null,
        options_json ? JSON.stringify(options_json) : null,
        id
      ]
    );
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.delete('/attributes/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const [ex]: any = await db.execute(
      `SELECT TOP 1 id
         FROM attribute_definitions
        WHERE id = ? AND owner_user_id = ?`,
      [id, ownerId]
    );
    if (!ex.length) return reply.code(404).send({ message: 'not_found' });

    await db.execute('DELETE FROM item_attributes WHERE attribute_id = ?', [id]);
    await db.execute('DELETE FROM attribute_definitions WHERE id = ?', [id]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.post('/items/:id/attributes', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) return reply.code(400).send({ message: 'itemId inválido' });

    const [it]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemId, ownerId]
    );
    if (!it.length) return reply.code(404).send({ message: 'item_not_found' });

    const body = req.body || {};
    const attrs = Array.isArray(body) ? body : (Array.isArray(body?.attributes) ? body.attributes : []);
    if (!attrs.length) return reply.code(400).send({ message: 'attributes requerido (array)' });

    let upserted = 0;
    for (const a of attrs) {
      let attributeId: number | null = Number.isFinite(Number(a?.attributeId)) ? Number(a.attributeId) : null;
      if (!attributeId && a?.attributeName) {
        const nm = String(a.attributeName).trim();
        if (!nm) continue;
        const [ex]: any = await db.execute(
          `SELECT TOP 1 id
             FROM attribute_definitions
            WHERE owner_user_id = ? AND name = ?`,
          [ownerId, nm]
        );
        if (ex.length) attributeId = Number(ex[0].id);
        else {
          const [ins]: any = await db.execute(
            `INSERT INTO attribute_definitions (owner_user_id, name, attr_type)
             VALUES (?,?,?)`,
            [ownerId, nm, a?.attrType && ['text','number','date','list'].includes(String(a.attrType)) ? a.attrType : 'text']
          );
          attributeId = Number(ins.insertId);
        }
      }
      if (!attributeId) continue;

      const vText = a?.valueText ?? (typeof a?.value === 'string' ? a.value : null);
      const vNum  = a?.valueNumber ?? (Number.isFinite(Number(a?.value)) ? Number(a.value) : null);
      const vDate = a?.valueDate ?? null;

      await db.execute(
        'DELETE FROM item_attributes WHERE item_id = ? AND attribute_id = ?',
        [itemId, attributeId]
      );
      await db.execute(
        `INSERT INTO item_attributes (item_id, attribute_id, value_text, value_number, value_date)
         VALUES (?,?,?,?,?)`,
        [itemId, attributeId, vText ?? null, vNum ?? null, vDate ?? null]
      );
      upserted++;
    }

    reply.send({ ok: true, count: upserted });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.get('/items/:id/attributes', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) return reply.code(400).send({ message: 'itemId inválido' });

    const [it]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemId, ownerId]
    );
    if (!it.length) return reply.code(404).send({ message: 'item_not_found' });

    const [rows]: any = await db.execute(
      `SELECT ia.attribute_id AS attributeId,
              ad.name,
              ad.attr_type AS attrType,
              ia.value_text AS valueText,
              ia.value_number AS valueNumber,
              ia.value_date AS valueDate
         FROM item_attributes ia
         JOIN attribute_definitions ad ON ad.id = ia.attribute_id
        WHERE ia.item_id = ?`,
      [itemId]
    );
    reply.send(rows);
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.delete('/items/:id/attributes/:attributeId', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    const attributeId = Number(req.params.attributeId);
    if (!Number.isFinite(itemId) || !Number.isFinite(attributeId))
      return reply.code(400).send({ message: 'parámetros inválidos' });

    const [it]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemId, ownerId]
    );
    if (!it.length) return reply.code(404).send({ message: 'item_not_found' });

    await db.execute(
      'DELETE FROM item_attributes WHERE item_id = ? AND attribute_id = ?',
      [itemId, attributeId]
    );
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

// ------------------- COLLECTIONS -------------------
function toAbsFromFsOrUrl(p?: string | null): string | null {
  if (!p) return null;
  // 1) si ya es URL, la devolvemos
  if (/^https?:\/\//i.test(p)) return p;

  // 2) si es path físico, lo pasamos a /uploads/...
  const rel = toPublicUrl(p);          // "/uploads/xxx.png" o null
  const abs = toAbsoluteUrl(rel);      // "https://API/uploads/xxx.png" o null
  return abs || rel || null;
}

function parseThumbsJson(raw: any): string[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw || []);
    return (Array.isArray(arr) ? arr : [])
      .map((x: any) => x?.file_path ?? x?.filePath ?? x?.url ?? x)
      .map((p: any) => (typeof p === 'string' ? toAbsFromFsOrUrl(p) : null))
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

app.post('/collections', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const { name, description, type = 'smart', filter_json, sort_key = 'issue_year', sort_dir = 'asc' } = req.body || {};
    if (!name) return reply.code(400).send({ message: 'name requerido' });

    const [r]: any = await db.execute(
      `INSERT INTO collections
         (owner_user_id, name, description, type, filter_json, sort_key, sort_dir)
       VALUES (?,?,?,?,?,?,?)`,
      [
        ownerId,
        name,
        description || null,
        type === 'static' ? 'static' : 'smart',
        filter_json ? JSON.stringify(filter_json) : null,
        sort_key,
        (String(sort_dir).toLowerCase() === 'desc' ? 'desc' : 'asc')
      ]
    );
    reply.send({ id: r.insertId });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.put('/collections/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });
    const { name, description, type, filter_json, sort_key, sort_dir } = req.body || {};

    const [c]: any = await db.execute(
      'SELECT TOP 1 id FROM collections WHERE id = ? AND owner_user_id = ?',
      [id, ownerId]
    );
    if (!c.length) return reply.code(404).send({ message: 'not_found' });

    await db.execute(
      `UPDATE collections
          SET name = COALESCE(?, name),
              description = COALESCE(?, description),
              type = COALESCE(?, type),
              filter_json = COALESCE(?, filter_json),
              sort_key = COALESCE(?, sort_key),
              sort_dir = COALESCE(?, sort_dir)
        WHERE id = ?`,
      [
        name ?? null,
        description ?? null,
        type ? (type === 'static' ? 'static' : 'smart') : null,
        filter_json ? JSON.stringify(filter_json) : null,
        sort_key ?? null,
        sort_dir ? (String(sort_dir).toLowerCase() === 'desc' ? 'desc' : 'asc') : null,
        id
      ]
    );
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.get('/collections', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);

    const hasThumbsJson = await hasColumn('collections', 'thumbs_json');

    const [rows]: any = await db.execute(
      `
      SELECT id,
             name,
             description,
             type,
             filter_json,
             sort_key,
             sort_dir,
             created_at,
             updated_at,
             parent_collection_id,
             cover_image_path
             ${hasThumbsJson ? ', thumbs_json' : ''}
        FROM collections
       WHERE owner_user_id = ?
         AND parent_collection_id IS NULL
       ORDER BY created_at DESC
      `,
      [ownerId]
    );

    // helpers locales (no rompen tu estructura actual)
    const parseFilterJson = (raw: any) => {
      try {
        if (raw == null || raw === '') return {};
        if (typeof raw === 'string') return JSON.parse(raw);
        if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString('utf8'));
        if (typeof raw === 'object') return raw;
      } catch {}
      return {};
    };

    const uniqNum = (arr: any[]) =>
      Array.from(new Set((arr || []).map(Number).filter(Number.isFinite)));

    const buildAttrChip = (a: any) => {
      // intentamos “adivinar” estructura común: { key/name/field, op/operator, value/val/values }
      const k = a?.key ?? a?.name ?? a?.field ?? a?.attr ?? a?.attribute ?? null;
      const op = (a?.op ?? a?.operator ?? '').toString().toUpperCase();
      const v = a?.value ?? a?.val ?? a?.values ?? a?.v ?? null;

      if (!k) return '';
      const key = String(k).replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

      if (Array.isArray(v)) {
        const short = v.slice(0, 3).map(x => String(x)).join(', ');
        return `${key}${op ? ` ${op}` : ''}: ${short}${v.length > 3 ? '…' : ''}`;
      }
      if (v === null || v === undefined || v === '') return `${key}${op ? ` ${op}` : ''}`;
      return `${key}${op ? ` ${op}` : ''}: ${String(v)}`;
    };

    const out: any[] = [];

    for (const r of (rows || [])) {
      const coverAbs = toAbsFromFsOrUrl(r.cover_image_path);

      // =========================
      // ✅ 0) ARMAR TAGS/ATTRS para UI (solo SMART)
      // =========================
      let filter_tag_ids: number[] = [];
      let filter_tags: string[] = [];
      let filter_tag_mode: string | null = null;
      let filter_attrs: any[] = [];
      let filter_chips: string[] = [];

      if (String(r.type).toLowerCase() === 'smart') {
        const f = parseFilterJson(r.filter_json);

        // usa TU builder como fuente de verdad
        const built = buildWhereFromFilter(ownerId, f);
        const { tagIds, tagNames, tagMode, attrFilters } = built;

        filter_tag_mode = (tagMode || 'OR').toString().toUpperCase();
        filter_attrs = Array.isArray(attrFilters) ? attrFilters : [];

        // 1) resolver tag names -> ids (si vinieron nombres)
        let idsFromNames: number[] = [];
        if (Array.isArray(tagNames) && tagNames.length) {
          const placeholders = tagNames.map(() => '?').join(',');
          const ownerFilter = await tagsOwnerWhere(ownerId);

          const [trs]: any = await db.execute(
            `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
            [...ownerFilter.params, ...tagNames]
          );

          idsFromNames = (trs || []).map((x: any) => x.id);
        }

        // 2) ids finales
        filter_tag_ids = uniqNum([...(tagIds || []), ...idsFromNames]);

        // 3) resolver ids -> nombres (PARA MOSTRAR)
        if (filter_tag_ids.length) {
          const placeholders = filter_tag_ids.map(() => '?').join(',');
          const ownerFilter = await tagsOwnerWhere(ownerId);

          const [tns]: any = await db.execute(
            `SELECT id, name FROM tags WHERE ${ownerFilter.where} AND id IN (${placeholders})`,
            [...ownerFilter.params, ...filter_tag_ids]
          );

          // orden estable según ids
          const map = new Map<number, string>((tns || []).map((x: any) => [Number(x.id), x.name]));
          filter_tags = filter_tag_ids.map(id => map.get(id)).filter(Boolean) as string[];
        }

        // 4) chips listos para UI (máx 10)
        // - tags
        if (filter_tags.length) {
          // “Tags (AND): A, B”
          const head = `Tags (${filter_tag_mode}):`;
          const body = filter_tags.slice(0, 5).join(', ') + (filter_tags.length > 5 ? '…' : '');
          filter_chips.push(`${head} ${body}`);
        }

        // - attrs (cada uno como chip)
        if (filter_attrs.length) {
          for (const a of filter_attrs.slice(0, 6)) {
            const cchip = buildAttrChip(a);
            if (cchip) filter_chips.push(cchip);
          }
        }

        // - rangos comunes (si tu filter_json los tiene)
        if (f?.country) filter_chips.push(`País: ${String(f.country)}`);
        if (f?.condition) filter_chips.push(`Condición: ${String(f.condition)}`);
        if (f?.yearFrom != null || f?.yearTo != null) {
          filter_chips.push(`Año: ${f.yearFrom ?? '—'}–${f.yearTo ?? '—'}`);
        }

        filter_chips = filter_chips.slice(0, 10);
      }

      // =========================
      // ✅ 1) thumbs desde thumbs_json si existiera y estuviera lleno
      // =========================
      let thumbs: string[] = hasThumbsJson ? parseThumbsJson(r.thumbs_json) : [];

      // =========================
      // ✅ 2) fallback: calcular thumbs si no hay thumbs_json
      // =========================
      if (!thumbs.length) {
        if (String(r.type).toLowerCase() === 'static') {
          const [trows]: any = await db.execute(
            `
            SELECT TOP 6 img.file_path AS filePath
              FROM collection_items ci
              JOIN philatelic_items i
                ON i.id = ci.item_id
               AND i.owner_user_id = ?
              JOIN item_images img
                ON img.item_id = i.id
             WHERE ci.collection_id = ?
             ORDER BY img.is_primary DESC, img.id ASC
            `,
            [ownerId, r.id]
          );

          thumbs = (trows || [])
            .map((x: any) => toAbsFromFsOrUrl(x.filePath))
            .filter(Boolean) as string[];
        } else {
          // SMART: usar filter_json y traer TOP 6 covers (tu lógica actual)
          let f: any = {};
          try {
            const raw = r.filter_json;
            if (raw == null || raw === '') f = {};
            else if (typeof raw === 'string') f = JSON.parse(raw);
            else if (Buffer.isBuffer(raw)) f = JSON.parse(raw.toString('utf8'));
            else if (typeof raw === 'object') f = raw;
          } catch {
            f = {};
          }

          const built = buildWhereFromFilter(ownerId, f);
          const { where, params, tagIds, tagNames, tagMode, attrFilters } = built;

          let join = '';
          const joinParams: any[] = [];

          if ((tagIds.length + tagNames.length) > 0) {
            let allTagIds = [...tagIds];

            if (tagNames.length) {
              const placeholders = tagNames.map(() => '?').join(',');
              const ownerFilter = await tagsOwnerWhere(ownerId);
              const [trs]: any = await db.execute(
                `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
                [...ownerFilter.params, ...tagNames]
              );
              allTagIds = allTagIds.concat(trs.map((x: any) => x.id));
            }

            const uniqueIds = Array.from(
              new Set(allTagIds.map(Number).filter(Number.isFinite))
            );

            if (uniqueIds.length) {
              if (String(tagMode || 'OR').toUpperCase() === 'AND') {
                join += `
                  JOIN (
                    SELECT it.item_id
                      FROM item_tags it
                     WHERE it.tag_id IN (${uniqueIds.map(() => '?').join(',')})
                     GROUP BY it.item_id
                    HAVING COUNT(DISTINCT it.tag_id) = ${uniqueIds.length}
                  ) tfilter ON tfilter.item_id = i.id`;
                joinParams.push(...uniqueIds);
              } else {
                join += `
                  JOIN item_tags itf
                    ON itf.item_id = i.id
                   AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})`;
                joinParams.push(...uniqueIds);
              }
            }
          }

          const { join: attrJoin, params: attrParams } = await buildAttrJoins(
            ownerId,
            attrFilters
          );
          join += attrJoin;
          joinParams.push(...attrParams);

          const sqlThumbs = `
            SELECT TOP 6
              (
                SELECT TOP 1 file_path
                  FROM item_images
                 WHERE item_id = i.id
                 ORDER BY is_primary DESC, id ASC
              ) AS cover
            FROM philatelic_items i
            ${join}
            WHERE ${where.join(' AND ')}
            ORDER BY i.${r.sort_key || 'issue_year'} ${String(r.sort_dir || 'asc').toUpperCase()}
          `;

          const [trows]: any = await db.execute(sqlThumbs, [...joinParams, ...params]);

          thumbs = (trows || [])
            .map((x: any) => toAbsFromFsOrUrl(x.cover))
            .filter(Boolean) as string[];
        }
      }

      // (opcional) asegurar que cover esté dentro de thumbs al inicio
      if (coverAbs) {
        thumbs = [coverAbs, ...thumbs.filter((u) => u !== coverAbs)].slice(0, 12);
      }

      out.push({
        ...r,
        cover_image_path: coverAbs,
        thumbs,
        thumb: coverAbs || (thumbs[0] || null),

        // ✅ NUEVO: lo que necesitas para mostrar en cards
        filter_tag_ids,
        filter_tags,
        filter_tag_mode,
        filter_attrs,
        filter_chips,
      });
    }

    reply.send(out);
  } catch (e: any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


// app.get('/collections/:id/items', { preHandler: authGuard }, async (req: any, reply: any) => {
//   try {
//     if (req.method === 'GET' && req.body != null) {
//       try { req.log?.warn({ bodyType: typeof req.body }, 'GET con body recibido; se ignora'); } catch {}
//       // @ts-ignore
//       req.body = undefined;
//     }

//     const ownerId = ensureAuth(req);
//     const id = Number(req.params.id);
//     if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

//     const [rows]: any = await db.execute(
//       `SELECT TOP 1 id, type, filter_json, sort_key, sort_dir
//          FROM collections
//         WHERE id = ? AND owner_user_id = ?`,
//       [id, ownerId]
//     );
//     const col = rows?.[0];
//     if (!col) return reply.code(404).send({ message: 'not_found' });

//     let items: any[] = [];

//     if (col.type === 'static') {
//       const [is]: any = await db.execute(
//         `SELECT i.id,
//                 i.title,
//                 i.country,
//                 i.issue_year AS issueYear,
//                 (
//                   SELECT TOP 1 file_path
//                   FROM item_images
//                   WHERE item_id = i.id
//                   ORDER BY is_primary DESC, id ASC
//                 ) AS cover
//            FROM collection_items ci
//            JOIN philatelic_items i
//              ON i.id = ci.item_id
//             AND i.owner_user_id = ?
//           WHERE ci.collection_id = ?
//           ORDER BY i.${col.sort_key || 'issue_year'} ${String(col.sort_dir || 'asc').toUpperCase()}`,
//         [ownerId, id]
//       );
//       items = is;
//     } else {
//       let f: any = {};
//       try {
//         const raw = col.filter_json;
//         if (raw == null || raw === '') f = {};
//         else if (typeof raw === 'string') f = JSON.parse(raw);
//         else if (Buffer.isBuffer(raw)) f = JSON.parse(raw.toString('utf8'));
//         else if (typeof raw === 'object') f = raw;
//         else f = {};
//       } catch {
//         f = {};
//       }

//       const { where, params, tagIds, tagNames, tagMode, attrFilters } = buildWhereFromFilter(ownerId, f);
//       let join = '';

//       if ((tagIds.length + tagNames.length) > 0) {
//         let allTagIds = [...tagIds];

//         if (tagNames.length) {
//           const placeholders = tagNames.map(() => '?').join(',');
//           const ownerFilter = await tagsOwnerWhere(ownerId);
//           const [trs]: any = await db.execute(
//             `SELECT id
//                FROM tags
//               WHERE ${ownerFilter.where}
//                 AND name IN (${placeholders})`,
//             [...ownerFilter.params, ...tagNames]
//           );
//           allTagIds = allTagIds.concat(trs.map((r: any) => r.id));
//         }

//         const uniqueIds = Array.from(new Set(allTagIds.map(Number).filter(Number.isFinite)));
//         if (uniqueIds.length) {
//           if (tagMode === 'AND') {
//             join += `
//               JOIN (
//                 SELECT it.item_id
//                   FROM item_tags it
//                  WHERE it.tag_id IN (${uniqueIds.map(() => '?').join(',')})
//                  GROUP BY it.item_id
//                 HAVING COUNT(DISTINCT it.tag_id) = ${uniqueIds.length}
//               ) tfilter ON tfilter.item_id = i.id`;
//             params.push(...uniqueIds);
//           } else {
//             join += `
//               JOIN item_tags itf
//                 ON itf.item_id = i.id
//                AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})`;
//             params.push(...uniqueIds);
//           }
//         }
//       }

//       const { join: attrJoin, params: attrParams } = await buildAttrJoins(ownerId, attrFilters);
//       join += attrJoin;
//       params.push(...attrParams);

//       const sql = `
//         SELECT DISTINCT
//                i.id,
//                i.title,
//                i.country,
//                i.issue_year AS issueYear,
//                (
//                  SELECT TOP 1 file_path
//                  FROM item_images
//                  WHERE item_id = i.id
//                  ORDER BY is_primary DESC, id ASC
//                ) AS cover
//           FROM philatelic_items i
//           ${join}
//          WHERE ${where.join(' AND ')}
//          ORDER BY i.${col.sort_key || 'issue_year'} ${String(col.sort_dir || 'asc').toUpperCase()}`;

//       const [is]: any = await db.execute(sql, params);
//       items = is;
//     }

//     // 🔹 AQUÍ el cambio importante
//     const out = items.map((r: any) => {
//       const rel = toPublicUrl(r.cover);   // "/uploads/..."
//       const abs = toAbsoluteUrl(rel);     // "https://filatelia-api.../uploads/..."
//       return { ...r, cover: abs || rel };
//     });

//     reply.send(out);
//   } catch (e: any) {
//     req.log?.error(e, 'Error en GET /collections/:id/items');
//     reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
//   }
// });


// ✅ helper: ponlo arriba del endpoint (o en utils)


// ✅ helper (déjalo tal cual)
function safeJsonArray(x: any) {
  try {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    if (Buffer.isBuffer(x)) return JSON.parse(x.toString('utf8'));
    if (typeof x === 'string') return JSON.parse(x);
    return [];
  } catch {
    return [];
  }
}

app.get('/collections/:id/items', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ message: 'id inválido' });
    }

    const [rows]: any = await db.execute(
      `SELECT TOP 1 id, type, filter_json, sort_key, sort_dir
         FROM collections
        WHERE id = ? AND owner_user_id = ?`,
      [id, ownerId]
    );

    const col = rows?.[0];
    if (!col) {
      return reply.code(404).send({ message: 'not_found' });
    }

    let items: any[] = [];

    /* =====================================================
       STATIC COLLECTION
    ===================================================== */
    if (col.type === 'static') {
      const [is]: any = await db.execute(
        `
        SELECT
          i.id,
          i.title,
          i.country,
          i.issue_year AS issueYear,
          (
            SELECT TOP 1 file_path
            FROM item_images
            WHERE item_id = i.id
            ORDER BY is_primary DESC, id ASC
          ) AS cover,

          -- TAGS
          (
            SELECT t.id, t.name
            FROM item_tags it
            JOIN tags t ON t.id = it.tag_id
            WHERE it.item_id = i.id
              AND t.owner_user_id = ?
            FOR JSON PATH
          ) AS tagsJson,

          -- ATTRIBUTES (SEGÚN TU ESQUEMA REAL)
          (
            SELECT
              ad.id,
              ad.name,
              COALESCE(
                ia.value_text,
                CAST(ia.value_number AS varchar(50)),
                CONVERT(varchar(10), ia.value_date, 23)
              ) AS value
            FROM item_attributes ia
            JOIN attribute_definitions ad
              ON ad.id = ia.attribute_id
            WHERE ia.item_id = i.id
              AND ad.owner_user_id = ?
            FOR JSON PATH
          ) AS attrsJson

        FROM collection_items ci
        JOIN philatelic_items i
          ON i.id = ci.item_id
         AND i.owner_user_id = ?
        WHERE ci.collection_id = ?
        ORDER BY i.${col.sort_key || 'issue_year'} ${String(col.sort_dir || 'asc').toUpperCase()}
        `,
        [ownerId, ownerId, ownerId, id]
      );

      items = is;
    }

    /* =====================================================
       SMART / DYNAMIC COLLECTION
    ===================================================== */
    else {
      let f: any = {};
      try {
        f = col.filter_json
          ? JSON.parse(
              Buffer.isBuffer(col.filter_json)
                ? col.filter_json.toString('utf8')
                : col.filter_json
            )
          : {};
      } catch {
        f = {};
      }

      const { where, params, tagIds, tagNames, tagMode, attrFilters } =
        buildWhereFromFilter(ownerId, f);

      let join = '';

      if ((tagIds.length + tagNames.length) > 0) {
        let allTagIds = [...tagIds];

        if (tagNames.length) {
          const placeholders = tagNames.map(() => '?').join(',');
          const ownerFilter = await tagsOwnerWhere(ownerId);

          const [trs]: any = await db.execute(
            `SELECT id FROM tags
              WHERE ${ownerFilter.where}
                AND name IN (${placeholders})`,
            [...ownerFilter.params, ...tagNames]
          );

          allTagIds.push(...trs.map((r: any) => r.id));
        }

        const uniqueIds = [...new Set(allTagIds)];

        if (uniqueIds.length) {
          if (tagMode === 'AND') {
            join += `
              JOIN (
                SELECT item_id
                FROM item_tags
                WHERE tag_id IN (${uniqueIds.map(() => '?').join(',')})
                GROUP BY item_id
                HAVING COUNT(DISTINCT tag_id) = ${uniqueIds.length}
              ) tfilter ON tfilter.item_id = i.id
            `;
          } else {
            join += `
              JOIN item_tags itf
                ON itf.item_id = i.id
               AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})
            `;
          }

          params.push(...uniqueIds);
        }
      }

      const { join: attrJoin, params: attrParams } =
        await buildAttrJoins(ownerId, attrFilters);

      join += attrJoin;
      params.push(...attrParams);

      const sql = `
        SELECT DISTINCT
          i.id,
          i.title,
          i.country,
          i.issue_year AS issueYear,
          (
            SELECT TOP 1 file_path
            FROM item_images
            WHERE item_id = i.id
            ORDER BY is_primary DESC, id ASC
          ) AS cover,

          (
            SELECT t.id, t.name
            FROM item_tags it
            JOIN tags t ON t.id = it.tag_id
            WHERE it.item_id = i.id
              AND t.owner_user_id = ?
            FOR JSON PATH
          ) AS tagsJson,

          (
            SELECT
              ad.id,
              ad.name,
              COALESCE(
                ia.value_text,
                CAST(ia.value_number AS varchar(50)),
                CONVERT(varchar(10), ia.value_date, 23)
              ) AS value
            FROM item_attributes ia
            JOIN attribute_definitions ad
              ON ad.id = ia.attribute_id
            WHERE ia.item_id = i.id
              AND ad.owner_user_id = ?
            FOR JSON PATH
          ) AS attrsJson

        FROM philatelic_items i
        ${join}
        WHERE ${where.join(' AND ')}
        ORDER BY i.${col.sort_key || 'issue_year'} ${String(col.sort_dir || 'asc').toUpperCase()}
      `;

      const [is]: any = await db.execute(sql, [ownerId, ownerId, ...params]);
      items = is;
    }

    /* =====================================================
       OUTPUT
    ===================================================== */
    reply.send(
      items.map((r: any) => {
        const rel = toPublicUrl(r.cover);
        const abs = toAbsoluteUrl(rel);

        return {
          id: r.id,
          title: r.title,
          country: r.country ?? null,
          issueYear: r.issueYear ?? null,
          cover: abs || rel || null,
          tags: safeJsonArray(r.tagsJson),
          attributes: safeJsonArray(r.attrsJson)
        };
      })
    );

  } catch (e: any) {
    req.log?.error(e, 'Error en GET /collections/:id/items');
    reply.code(500).send({ message: e?.message || 'internal_error' });
  }
});



app.post('/collections/:id/items', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const colId = Number(req.params.id);
    const { itemId } = req.body || {};

    const itemIdNum = Number(itemId);

    if (!Number.isFinite(colId) || !Number.isFinite(itemIdNum)) {
      return reply.code(400).send({ message: 'parámetros inválidos' });
    }

    // 1) Colección: traer también cover_image_path
    const [colRows]: any = await db.execute(
      'SELECT TOP 1 id, type, cover_image_path FROM collections WHERE id = ? AND owner_user_id = ?',
      [colId, ownerId]
    );

    if (!colRows.length) {
      return reply.code(404).send({ message: 'collection_not_found' });
    }
    if (colRows[0].type !== 'static') {
      return reply.code(400).send({ message: 'solo para colecciones estáticas' });
    }

    // 2) Item
    const [itemRows]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemIdNum, ownerId]
    );
    if (!itemRows.length) {
      return reply.code(404).send({ message: 'item_not_found' });
    }

    // 3) Vincular (INSERT si no existe)
    await db.execute(
      `INSERT INTO collection_items (collection_id, item_id)
       SELECT ?, ?
       WHERE NOT EXISTS (
         SELECT 1
           FROM collection_items
          WHERE collection_id = ? AND item_id = ?
       )`,
      [colId, itemIdNum, colId, itemIdNum]
    );

    // 4) ✅ Si la colección no tiene miniatura, setearla desde la imagen del item
    const currentCover = colRows[0]?.cover_image_path ?? null;

    if (!currentCover) {
      // buscar imagen del item (principal primero)
      const [imgRows]: any = await db.execute(
        `SELECT TOP 1 file_path
           FROM item_images
          WHERE item_id = ?
          ORDER BY is_primary DESC, id ASC`,
        [itemIdNum]
      );

      const coverPath = imgRows?.[0]?.file_path ?? null;

      if (coverPath) {
        await db.execute(
          `UPDATE collections
              SET cover_image_path = ?, updated_at = GETDATE()
            WHERE id = ?
              AND owner_user_id = ?
              AND (cover_image_path IS NULL OR cover_image_path = '')`,
          [coverPath, colId, ownerId]
        );
      }
    }

    return reply.send({ ok: true });
  } catch (e: any) {
    console.error('❌ POST /collections/:id/items error:', e);
    return reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});



app.delete('/collections/:id/items/:itemId', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(id) || !Number.isFinite(itemId))
      return reply.code(400).send({ message: 'parámetros inválidos' });

    const [col]: any = await db.execute(
      'SELECT TOP 1 id, type FROM collections WHERE id = ? AND owner_user_id = ?',
      [id, ownerId]
    );
    if (!col.length) return reply.code(404).send({ message: 'collection_not_found' });
    if (col[0].type !== 'static') return reply.code(400).send({ message: 'solo para colecciones estáticas' });

    await db.execute(
      'DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?',
      [id, itemId]
    );
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.delete('/collections/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const [col]: any = await db.execute(
      'SELECT TOP 1 id FROM collections WHERE id = ? AND owner_user_id = ?',
      [id, ownerId]
    );
    if (!col.length) return reply.code(404).send({ message: 'not_found' });

    await db.execute('DELETE FROM collection_items WHERE collection_id = ?', [id]);
    await db.execute('DELETE FROM collections WHERE id = ?', [id]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

// ------------------- SAVED SEARCHES -------------------
app.post('/saved-searches', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const { name, filter_json } = req.body || {};
    if (!name || !filter_json) return reply.code(400).send({ message: 'name y filter_json requeridos' });

    const [r]: any = await db.execute(
      `INSERT INTO saved_searches (owner_user_id, name, filter_json)
       VALUES (?,?,?)`,
      [ownerId, name, JSON.stringify(filter_json)]
    );
    reply.send({ id: r.insertId });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.get('/saved-searches', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const [rows]: any = await db.execute(
      `SELECT id, name, filter_json, created_at
         FROM saved_searches
        WHERE owner_user_id = ?
        ORDER BY created_at DESC`,
      [ownerId]
    );
    reply.send(rows);
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' }); }
});

app.delete('/saved-searches/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const [s]: any = await db.execute(
      'SELECT TOP 1 id FROM saved_searches WHERE id = ? AND owner_user_id = ?',
      [id, ownerId]
    );
    if (!s.length) return reply.code(404).send({ message: 'not_found' });

    await db.execute('DELETE FROM saved_searches WHERE id = ?', [id]);
    reply.send({ ok: true });
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});

// GET tags de un ítem
app.get('/items/:id/tags', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) return reply.code(400).send({ message: 'itemId inválido' });

    const [it]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemId, ownerId]
    );
    if (!it.length) return reply.code(404).send({ message: 'item_not_found' });

    const [rows]: any = await db.execute(
      `SELECT t.id, t.name
         FROM item_tags it
         JOIN tags t ON t.id = it.tag_id
        WHERE it.item_id = ?`,
      [itemId]
    );
    reply.send(rows);
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});

app.get('/collections/:id/items/search-sub', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const colId = Number(req.params.id);
    if (!Number.isFinite(colId)) return reply.code(400).send({ message: 'id inválido' });

    const [crows]: any = await db.execute(
      `SELECT TOP 1 id, type, filter_json, sort_key, sort_dir
         FROM collections
        WHERE id = ? AND owner_user_id = ?`,
      [colId, ownerId]
    );
    const col = crows?.[0];
    if (!col) return reply.code(404).send({ message: 'collection_not_found' });

    const q:any = req.query || {};
    const attrsExtra = parseJsonSafely(q.attrs, undefined);
    const extra = {
      q: q.q, country: q.country, condition: q.condition,
      yearFrom: q.yearFrom ? Number(q.yearFrom) : undefined,
      yearTo:   q.yearTo   ? Number(q.yearTo)   : undefined,
      tagIds:   Array.isArray(q.tagIds)   ? q.tagIds   : (q.tagIds   ? [q.tagIds]   : []),
      tagNames: Array.isArray(q.tagNames) ? q.tagNames : (q.tagNames ? [q.tagNames] : []),
      tagsMode: q.tagsMode,
      attrs:    attrsExtra
    };

    const offset = Number.isFinite(Number(q.offset)) && Number(q.offset) >= 0 ? Number(q.offset) : 0;
    const limit  = Number.isFinite(Number(q.limit))  && Number(q.limit)  >  0 ? Number(q.limit)  : 25;

    let baseJoin = '';
    const baseJoinParams:any[] = [];
    let whereParts:string[] = [];
    const whereParams:any[] = [];

    if (col.type === 'static') {
      baseJoin += ' JOIN collection_items ci ON ci.item_id = i.id AND ci.collection_id = ? ';
      baseJoinParams.push(colId);
      whereParts.push('i.owner_user_id = ?');
      whereParams.push(ownerId);
    } else {
      let fParent:any = {};
      try {
        const raw = col.filter_json;
        fParent = raw == null
          ? {}
          : (typeof raw === 'string'
              ? JSON.parse(raw)
              : (Buffer.isBuffer(raw)
                  ? JSON.parse(raw.toString('utf8'))
                  : raw));
      } catch { fParent = {}; }

      const { where: pWhere, params: pParams, tagIds: pTagIds, tagNames: pTagNames, tagMode: pTagMode, attrFilters: pAttr } =
        buildWhereFromFilter(ownerId, fParent);

      whereParts.push(...pWhere);
      whereParams.push(...pParams);

      if ((pTagIds.length + pTagNames.length) > 0) {
        let all = [...pTagIds];
        if (pTagNames.length) {
          const placeholders = pTagNames.map(()=>'?').join(',');
          const ownerFilter = await tagsOwnerWhere(ownerId);
          const [trs]: any = await db.execute(
            `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
            [...ownerFilter.params, ...pTagNames]
          );
          all = all.concat(trs.map((r:any)=>r.id));
        }
        const unique = Array.from(new Set(all.map(Number).filter(Number.isFinite)));
        if (unique.length) {
          if (String(pTagMode||'OR').toUpperCase()==='AND') {
            baseJoin += `
              JOIN (
                SELECT it.item_id
                  FROM item_tags it
                 WHERE it.tag_id IN (${unique.map(()=>'?').join(',')})
                 GROUP BY it.item_id
                HAVING COUNT(DISTINCT it.tag_id) = ${unique.length}
              ) tfilter_parent ON tfilter_parent.item_id = i.id`;
            baseJoinParams.push(...unique);
          } else {
            baseJoin += `
              JOIN item_tags itf_parent
                ON itf_parent.item_id = i.id
               AND itf_parent.tag_id IN (${unique.map(()=>'?').join(',')})`;
            baseJoinParams.push(...unique);
          }
        }
      }

      const { join: aj, params: ap } = await buildAttrJoins(ownerId, pAttr);
      baseJoin += aj; baseJoinParams.push(...ap);
    }

    const { where: eWhere, params: eParams, tagIds: eTagIds, tagNames: eTagNames, tagMode: eTagMode, attrFilters: eAttr } =
      buildWhereFromFilter(ownerId, extra);

    const eWhereFiltered:string[] = [];
    const eParamsFiltered:any[] = [];
    eWhere.forEach((w:string, idx:number) => {
      if (w.trim() !== 'i.owner_user_id = ?') {
        eWhereFiltered.push(w);
        eParamsFiltered.push(eParams[idx]);
      }
    });

    whereParts = [...whereParts, ...eWhereFiltered];
    whereParams.push(...eParamsFiltered);

    let joinExtra = '';
    const joinExtraParams:any[] = [];
    if ((eTagIds.length + eTagNames.length) > 0) {
      let all = [...eTagIds];
      if (eTagNames.length) {
        const placeholders = eTagNames.map(()=>'?').join(',');
        const ownerFilter = await tagsOwnerWhere(ownerId);
        const [trs]: any = await db.execute(
          `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
          [...ownerFilter.params, ...eTagNames]
        );
        all = all.concat(trs.map((r:any)=>r.id));
      }
      const unique = Array.from(new Set(all.map(Number).filter(Number.isFinite)));
      if (unique.length) {
        if (String(eTagMode||'OR').toUpperCase()==='AND') {
          joinExtra += `
            JOIN (
              SELECT it.item_id
                FROM item_tags it
               WHERE it.tag_id IN (${unique.map(()=>'?').join(',')})
               GROUP BY it.item_id
              HAVING COUNT(DISTINCT it.tag_id) = ${unique.length}
            ) tfilter_extra ON tfilter_extra.item_id = i.id`;
          joinExtraParams.push(...unique);
        } else {
          joinExtra += `
            JOIN item_tags itf_extra
              ON itf_extra.item_id = i.id
             AND itf_extra.tag_id IN (${unique.map(()=>'?').join(',')})`;
          joinExtraParams.push(...unique);
        }
      }
    }

    const { join: aj2, params: ap2 } = await buildAttrJoins(ownerId, eAttr);
    joinExtra += aj2; joinExtraParams.push(...ap2);

    const sql = `
      SELECT DISTINCT
        i.id,
        i.title,
        i.country,
        i.issue_year AS issueYear,
        (
          SELECT TOP 1 file_path
          FROM item_images
          WHERE item_id=i.id
          ORDER BY is_primary DESC, id ASC
        ) AS cover
      FROM philatelic_items i
      ${baseJoin}
      ${joinExtra}
      WHERE ${whereParts.join(' AND ')}
      ORDER BY i.${col.sort_key || 'issue_year'} ${String(col.sort_dir || 'asc').toUpperCase()}
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    const params = [...baseJoinParams, ...joinExtraParams, ...whereParams];
    const [rows]: any = await db.execute(sql, params);

    // 🔹 normalizamos cover a URL absoluta
    const out = rows.map((r: any) => {
      const rel = toPublicUrl(r.cover);   // "/uploads/..."
      const abs = toAbsoluteUrl(rel);     // "https://filatelia-api.../uploads/..."
      return { ...r, cover: abs || rel };
    });

    reply.send(out);
  } catch (e:any) {
    if (e?.message === 'UNAUTHORIZED') return reply.code(401).send({ message: 'unauthorized' });
    req.log?.error(e);
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


// =================== PRESENTATIONS: derive colecciones ===================
app.post(
  '/collections/:id/derive',
  { preHandler: authGuard },
  async (req: any, reply: any) => {
    const conn = await db.getConnection();
    try {
      const ownerId = ensureAuth(req);
      const parentId = Number(req.params.id);

      const {
        mode,                     // 'snapshot' | 'smart'
        name,
        description,
        history,                  // texto de historia opcional
        selectedItemIds = [],     // requerido si mode = 'snapshot'
        extraFilter = null,       // filtros extra (q, country, yearFrom, tagIds, attrs, etc.)
        coverItemId = null
      } = req.body || {};

      if (!Number.isFinite(parentId)) {
        return reply.code(400).send({ message: 'id inválido' });
      }
      if (!name || !mode) {
        return reply.code(400).send({ message: 'name y mode requeridos' });
      }

      const historyText: string | null =
        history == null ? null : (String(history).trim() || null);

      const [crows]: any = await conn.execute(
        `SELECT TOP 1 id, type, filter_json, cover_image_path
           FROM collections
          WHERE id = ? AND owner_user_id = ?`,
        [parentId, ownerId]
      );
      const parent = crows?.[0];
      if (!parent) {
        return reply.code(404).send({ message: 'collection_not_found' });
      }

      await conn.beginTransaction();

      // --- Portada base
      let coverPath: string | null = null;
      if (Number.isFinite(Number(coverItemId))) {
        const [im]: any = await conn.execute(
          `SELECT TOP 1 file_path
             FROM item_images
            WHERE item_id = ?
            ORDER BY is_primary DESC, id ASC`,
          [Number(coverItemId)]
        );
        coverPath = im?.[0]?.file_path || null;
      }

      // ===================== SNAPSHOT =====================
      if (String(mode).toLowerCase() === 'snapshot') {
        const ids = Array.from(
          new Set(
            (Array.isArray(selectedItemIds) ? selectedItemIds : [])
              .map((x: any) => Number(x))
              .filter(Number.isFinite)
          )
        );

        if (!ids.length) {
          await conn.rollback();
          return reply
            .code(400)
            .send({ message: 'selectedItemIds requeridos' });
        }

        if (parent.type === 'static') {
          const [chk]: any = await conn.execute(
            `SELECT item_id
               FROM collection_items
              WHERE collection_id = ?
                AND item_id IN (${ids.map(() => '?').join(',')})`,
            [parentId, ...ids]
          );
          const okSet = new Set(
            (chk || []).map((r: any) => Number(r.item_id))
          );
          if (okSet.size !== ids.length) {
            await conn.rollback();
            return reply
              .code(400)
              .send({ message: 'items_fuera_de_la_coleccion' });
          }
        } else {
          const [chk]: any = await conn.execute(
            `SELECT id
               FROM philatelic_items
              WHERE owner_user_id = ?
                AND id IN (${ids.map(() => '?').join(',')})`,
            [ownerId, ...ids]
          );
          if ((chk?.length || 0) !== ids.length) {
            await conn.rollback();
            return reply
              .code(400)
              .send({ message: 'item_no_pertenece_al_owner' });
          }
        }

        if (!coverPath) {
          const [im2]: any = await conn.execute(
            `SELECT TOP 1 file_path
               FROM item_images
              WHERE item_id = ?
              ORDER BY is_primary DESC, id ASC`,
            [ids[0]]
          );
          coverPath = im2?.[0]?.file_path || null;
        }

        const filter_json = {
          selectedFromCollectionId: parentId,
          selectedItemIds: ids,
          note: 'subselection snapshot'
        };

        const [insCol]: any = await conn.execute(
          `INSERT INTO collections
             (owner_user_id,
              name,
              description,
              history_text,
              type,
              filter_json,
              sort_key,
              sort_dir,
              parent_collection_id,
              cover_image_path)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            ownerId,
            name,
            description || null,
            historyText,
            'static',
            JSON.stringify(filter_json),
            'issue_year',
            'asc',
            parentId,
            coverPath
          ]
        );
        const newColId = Number(insCol.insertId);

        // ✅ SQL Server: insertar evitando duplicados
        const values = ids.map(id => `(${newColId},${id})`).join(',');
        await conn.execute(
          `INSERT INTO collection_items (collection_id, item_id)
           SELECT v.collection_id, v.item_id
             FROM (VALUES ${values}) AS v(collection_id, item_id)
            WHERE NOT EXISTS (
              SELECT 1
                FROM collection_items ci
               WHERE ci.collection_id = v.collection_id
                 AND ci.item_id = v.item_id
            );`
        );

        await conn.execute(
          `INSERT INTO presentations (owner_user_id, collection_id, title, description, cover_image_path)
           SELECT ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1
               FROM presentations
              WHERE owner_user_id = ?
                AND collection_id = ?
           )`,
          [ownerId, newColId, name, description || null, coverPath, ownerId, newColId]
        );

        const [prow]: any = await conn.execute(
          `SELECT TOP 1 id
             FROM presentations
            WHERE owner_user_id = ?
              AND collection_id = ?`,
          [ownerId, newColId]
        );
        const presentationId = Number(prow?.[0]?.id) || null;

        await conn.commit();
        return reply.send({
          id: newColId,
          type: 'static',
          cover: coverPath,
          count: ids.length,
          parent_collection_id: parentId,
          presentationId
        });
      }

      // ===================== SMART =====================
      let base: any = {};
      try {
        const raw = parent.filter_json;
        base =
          raw == null
            ? {}
            : typeof raw === 'string'
            ? JSON.parse(raw)
            : Buffer.isBuffer(raw)
            ? JSON.parse(raw.toString('utf8'))
            : raw;
      } catch {
        base = {};
      }

      let extra: any = {};
      try {
        const src = extraFilter;
        if (typeof src === 'string') extra = JSON.parse(src);
        else if (src && typeof src === 'object') extra = src;
      } catch {
        extra = {};
      }

      const uniq = <T>(arr: T[]) => Array.from(new Set(arr));
      const merged: any = {
        ...base,
        ...extra,
        tagIds: uniq([...(base.tagIds || []), ...(extra.tagIds || [])]),
        tagNames: uniq([
          ...(base.tagNames || []),
          ...(extra.tagNames || [])
        ]),
        attrs: [
          ...(Array.isArray(base.attrs) ? base.attrs : []),
          ...(Array.isArray(extra.attrs) ? extra.attrs : [])
        ],
        tagsMode: extra.tagsMode || base.tagsMode || 'OR'
      };

      if (!coverPath) {
        coverPath = parent.cover_image_path || null;
      }

      const [insCol]: any = await conn.execute(
        `INSERT INTO collections
           (owner_user_id,
            name,
            description,
            history_text,
            type,
            filter_json,
            sort_key,
            sort_dir,
            parent_collection_id,
            cover_image_path)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          ownerId,
          name,
          description || null,
          historyText,
          'smart',
          JSON.stringify(merged),
          'issue_year',
          'asc',
          parentId,
          coverPath
        ]
      );
      const newColId = Number(insCol.insertId);

      await conn.execute(
        `INSERT INTO presentations (owner_user_id, collection_id, title, description, cover_image_path)
         SELECT ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
             FROM presentations
            WHERE owner_user_id = ?
              AND collection_id = ?
         )`,
        [ownerId, newColId, name, description || null, coverPath, ownerId, newColId]
      );

      const [prow]: any = await conn.execute(
        `SELECT TOP 1 id
           FROM presentations
          WHERE owner_user_id = ?
            AND collection_id = ?`,
        [ownerId, newColId]
      );
      const presentationId = Number(prow?.[0]?.id) || null;

      await conn.commit();
      return reply.send({
        id: newColId,
        type: 'smart',
        cover: coverPath,
        parent_collection_id: parentId,
        filter_json: merged,
        presentationId
      });
    } catch (e: any) {
      try { await (conn as any).rollback(); } catch {}
      if (e?.message === 'UNAUTHORIZED') {
        return reply.code(401).send({ message: 'unauthorized' });
      }
      console.error('❌ /collections/:id/derive error:', e);
      req.log?.error(e);

      reply
        .code(500)
        .send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
    } finally {
      try { (conn as any).release(); } catch {}
    }
  }
);


// =================== PRESENTATIONS CRUD ===================
app.post('/presentations', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);

    const ct = String((req.headers['content-type'] || '')).toLowerCase();
    const isMultipart = ct.startsWith('multipart/form-data');

    let payload: any = {};
    let coverPath: string | null = null;

    if (isMultipart) {
      const parts = await (req.parts?.() as AsyncIterable<any>);
      if (!parts) return reply.code(400).send({ message: 'multipart requerido' });

      for await (const p of parts) {
        if (p?.type === 'field' && p.fieldname === 'metadata') {
          try { payload = JSON.parse(String(p.value ?? '{}')); }
          catch { return reply.code(400).send({ message: 'metadata inválido (JSON)' }); }
          continue;
        }
        if (p?.type === 'file' && p.fieldname === 'cover') {
          const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif']);
          if (!allowed.has(String(p.mimetype))) return reply.code(400).send({ message: 'portada no soportada' });
          const buf = await p.toBuffer();
          if (buf?.length) {
            const fs = require('fs'); const path = require('path');
            const base = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
            const safe = `pres-cover-${Date.now()}-${(p.filename||'cover').replace(/[^\w.\-]+/g,'_')}`;
            const full = path.join(base, safe);
            fs.writeFileSync(full, buf);
            coverPath = full;
          }
        }
      }
    } else {
      payload = req.body || {};
    }

    const { collection_id, title, description } = payload || {};
    const colId = Number(collection_id);
    if (!Number.isFinite(colId) || !title) {
      return reply.code(400).send({ message: 'collection_id (numérico) y title requeridos' });
    }

    const [col]: any = await db.execute(
      'SELECT TOP 1 id FROM collections WHERE id = ? AND owner_user_id = ?',
      [colId, ownerId]
    );
    if (!col.length) return reply.code(404).send({ message: 'collection_not_found' });

    const [r]: any = await db.execute(
      `INSERT INTO presentations (owner_user_id, collection_id, title, description, cover_image_path)
       VALUES (?,?,?,?,?)`,
      [ownerId, colId, String(title).trim(), description || null, coverPath]
    );
    reply.send({ id: r.insertId });
  } catch (e: any) {
    if (e?.message === 'UNAUTHORIZED') return reply.code(401).send({ message: 'unauthorized' });
    req.log?.error(e, 'POST /presentations');
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});

// app.get('/presentations', { preHandler: authGuard }, async (req: any, reply: any) => {
//   try {
//     const ownerId = ensureAuth(req);
//     const q = req.query || {};
//     const offset = Number.isFinite(Number(q.offset)) && Number(q.offset) >= 0 ? Number(q.offset) : 0;
//     const limit  = Number.isFinite(Number(q.limit))  && Number(q.limit)  >  0 ? Math.min(Number(q.limit), 100) : 20;

//     const [rows]: any = await db.execute(
//       `SELECT p.id,
//               p.title,
//               p.description,
//               p.cover_image_path AS cover,
//               p.collection_id,
//               p.created_at,
//               p.updated_at
//          FROM presentations p
//         WHERE p.owner_user_id = ?
//         ORDER BY p.updated_at DESC
//         OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
//       [ownerId]
//     );
//     reply.send(rows);
//   } catch (e:any) {
//     reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
//   }
// });

// app.get('/presentations/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
//   try {
//     const ownerId = ensureAuth(req);
//     const id = Number(req.params.id);
//     if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

//     const [rows]: any = await db.execute(
//       `SELECT TOP 1
//               p.id,
//               p.title,
//               p.description,
//               p.cover_image_path AS cover,
//               p.collection_id,
//               p.created_at,
//               p.updated_at,
//               (SELECT COUNT(*)
//                  FROM presentation_assets a
//                 WHERE a.presentation_id = p.id) AS assetsCount
//          FROM presentations p
//         WHERE p.id = ? AND p.owner_user_id = ?`,
//       [id, ownerId]
//     );
//     if (!rows.length) return reply.code(404).send({ message: 'not_found' });
//     reply.send(rows[0]);
//   } catch (e:any) {
//     reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
//   }
// });
app.get('/presentations', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const q: any = req.query || {};
    const offset = Number.isFinite(Number(q.offset)) && Number(q.offset) >= 0 ? Number(q.offset) : 0;
    const limit  = Number.isFinite(Number(q.limit))  && Number(q.limit)  >  0 ? Math.min(Number(q.limit), 100) : 20;

    const [rows]: any = await db.execute(
      `SELECT p.id,
              p.title,
              p.description,
              p.cover_image_path AS cover,
              p.collection_id,
              p.created_at,
              p.updated_at
         FROM presentations p
        WHERE p.owner_user_id = ?
        ORDER BY p.updated_at DESC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      [ownerId]
    );

    const out = (rows || []).map((r: any) => {
      const rel = toPublicUrl(r.cover);   // "/uploads/..."
      const abs = toAbsoluteUrl(rel);     // "https://filatelia-api.../uploads/..."
      return { ...r, cover: abs || rel };
    });

    reply.send(out);
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


app.get('/presentations/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const [rows]: any = await db.execute(
      `SELECT TOP 1
              p.id,
              p.title,
              p.description,
              p.cover_image_path AS cover,
              p.collection_id,
              p.created_at,
              p.updated_at,
              (SELECT COUNT(*)
                 FROM presentation_assets a
                WHERE a.presentation_id = p.id) AS assetsCount
         FROM presentations p
        WHERE p.id = ? AND p.owner_user_id = ?`,
      [id, ownerId]
    );
    if (!rows.length) return reply.code(404).send({ message: 'not_found' });

    const row = rows[0];

    // 🔹 normaliza la portada
    const rel = toPublicUrl(row.cover);   // "/uploads/..."
    const abs = toAbsoluteUrl(rel);       // "https://filatelia-api.../uploads/..."
    const out = { ...row, cover: abs || rel };

    reply.send(out);
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


app.put('/presentations/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const ct = String((req.headers['content-type'] || '')).toLowerCase();
    const isMultipart = ct.startsWith('multipart/form-data');

    let payload: any = {};
    let coverPath: string | undefined = undefined;

    if (isMultipart) {
      const parts = await (req.parts?.() as AsyncIterable<any>);
      if (!parts) return reply.code(400).send({ message: 'multipart requerido' });

      for await (const p of parts) {
        if (p?.type === 'field' && p.fieldname === 'metadata') {
          try { payload = JSON.parse(String(p.value ?? '{}')); }
          catch { return reply.code(400).send({ message: 'metadata inválido (JSON)' }); }
          continue;
        }
        if (p?.type === 'field' && p.fieldname === 'clearCover') {
          const val = String(p.value ?? '').toLowerCase();
          if (val === 'true' || val === '1') coverPath = null as any;
          continue;
        }
        if (p?.type === 'file' && p.fieldname === 'cover') {
          const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif']);
          if (!allowed.has(String(p.mimetype))) return reply.code(400).send({ message: 'portada no soportada' });
          const buf = await p.toBuffer();
          if (buf?.length) {
            const fs = require('fs'); const path = require('path');
            const base = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
            const safe = `pres-cover-${Date.now()}-${(p.filename||'cover').replace(/[^\w.\-]+/g,'_')}`;
            const full = path.join(base, safe);
            fs.writeFileSync(full, buf);
            coverPath = full;
          }
        }
      }
    } else {
      payload = req.body || {};
      if ('clearCover' in payload && (payload.clearCover === true || payload.clearCover === 'true')) {
        coverPath = null as any;
      }
    }

    const { title, description } = payload || {};

    const [ex]: any = await db.execute(
      'SELECT TOP 1 id, cover_image_path FROM presentations WHERE id = ? AND owner_user_id = ?',
      [id, ownerId]
    );
    if (!ex.length) return reply.code(404).send({ message: 'not_found' });

    await db.execute(
      `UPDATE presentations
          SET title = COALESCE(?, title),
              description = COALESCE(?, description),
              cover_image_path = ${coverPath === undefined ? 'cover_image_path' : '?'}
        WHERE id = ?`,
      coverPath === undefined
        ? [title ?? null, description ?? null, id]
        : [title ?? null, description ?? null, (coverPath ?? null), id]
    );

    reply.send({ ok: true });
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});

app.delete('/presentations/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const [r]: any = await db.execute(
      'DELETE FROM presentations WHERE id = ? AND owner_user_id = ?',
      [id, ownerId]
    );
    if (r.affectedRows === 0) return reply.code(404).send({ message: 'not_found' });
    reply.send({ ok: true });
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});

// =================== PRESENTATION ASSETS ===================
function parseMeta(raw: any) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    if (Buffer.isBuffer(raw)) {
      return JSON.parse(raw.toString('utf8'));
    }
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }
  } catch {}
  return null;
}

app.get(
  "/presentations/:id/assets",
  { preHandler: authGuard },
  async (req: any, reply: any) => {
    try {
      const ownerId = ensureAuth(req);
      const presId = Number(req.params.id);
      if (!Number.isFinite(presId)) {
        return reply.code(400).send({ message: "id inválido" });
      }

      const [p]: any = await db.execute(
        "SELECT TOP 1 id FROM presentations WHERE id = ? AND owner_user_id = ?",
        [presId, ownerId]
      );
      if (!p.length) {
        return reply.code(404).send({ message: "presentation_not_found" });
      }

      const [rows]: any = await db.execute(
        `SELECT id,
                kind,
                file_path  AS filePath,
                url,
                meta_json  AS metaJson,
                created_at AS createdAt
           FROM presentation_assets
          WHERE presentation_id = ?
          ORDER BY created_at ASC, id ASC`,
        [presId]
      );

      const assets = rows.map((r: any) => ({
        id:        r.id,
        kind:      r.kind,
        filePath:  r.filePath,
        url:       r.url,
        metaJson:  parseMeta(r.metaJson),
        createdAt: r.createdAt,
      }));

      return reply.send(assets);
    } catch (e: any) {
      req.log?.error(e, "list-assets failed");
      return reply.code(500).send({
        message: "list_assets_failed",
        detail: e?.message ?? "unknown_error",
      });
    }
  }
);

app.post('/presentations/:id/assets', { preHandler: authGuard }, async (req:any, reply:any) => {
  try {
    const ownerId = ensureAuth(req);
    const presId = Number(req.params.id);
    if (!Number.isFinite(presId)) return reply.code(400).send({ message: 'id inválido' });

    const [ex]: any = await db.execute(
      'SELECT TOP 1 id FROM presentations WHERE id = ? AND owner_user_id = ?',
      [presId, ownerId]
    );
    if (!ex.length) return reply.code(404).send({ message: 'presentation_not_found' });

    const ct = String((req.headers['content-type'] || '')).toLowerCase();
    const isMultipart = ct.startsWith('multipart/form-data');

    let kind: string | null = null;
    let url: string | null = null;
    let metaJson: any = null;
    let filePath: string | null = null;

    if (isMultipart) {
      const parts = await (req.parts?.() as AsyncIterable<any>);
      if (!parts) return reply.code(400).send({ message: 'multipart requerido' });

      for await (const p of parts) {
        if (p?.type === 'field') {
          if (p.fieldname === 'kind') kind = String(p.value ?? '').toLowerCase();
          else if (p.fieldname === 'url') url = String(p.value ?? '').trim() || null;
          else if (p.fieldname === 'meta_json') {
            try { metaJson = JSON.parse(String(p.value ?? '{}')); } catch {}
          }
          continue;
        }

        if (p?.type === 'file' && p.fieldname === 'file') {
          const buf = await p.toBuffer();
          if (buf?.length) {
            const fs = require('fs');
            const path = require('path');
            const base = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
            const safe = `pres-${presId}-${Date.now()}-${(p.filename||'asset').replace(/[^\w.\-]+/g,'_')}`;
            const full = path.join(base, safe);
            fs.writeFileSync(full, buf);
            filePath = full;
            url = `/uploads/${safe}`;
          }
          continue;
        }
      }
    } else {
      const body = req.body || {};
      kind = body?.kind ? String(body.kind).toLowerCase() : null;
      url  = body?.url ? String(body.url).trim() : null;
      metaJson = body?.meta_json ?? body?.metaJson ?? null;
    }

    if (!kind || !['video','ppt','image','text','link'].includes(kind)) {
      return reply.code(400).send({ message: 'kind inválido' });
    }
    if (!filePath && !url && kind !== 'text') {
      return reply.code(400).send({ message: 'se requiere file o url (excepto kind=text)' });
    }

    const [r]: any = await db.execute(
      `INSERT INTO presentation_assets (presentation_id, kind, file_path, url, meta_json)
       VALUES (?,?,?,?,?)`,
      [presId, kind, filePath, url, metaJson ? JSON.stringify(metaJson) : null]
    );
    reply.send({ id: r.insertId });
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});

app.delete('/presentations/:id/assets/:assetId', { preHandler: authGuard }, async (req:any, reply:any) => {
  try {
    const ownerId = ensureAuth(req);
    const presId = Number(req.params.id);
    const assetId = Number(req.params.assetId);
    if (!Number.isFinite(presId) || !Number.isFinite(assetId)) {
      return reply.code(400).send({ message: 'parámetros inválidos' });
    }

    const [chk]: any = await db.execute(
      `SELECT TOP 1 a.id, a.file_path
         FROM presentation_assets a
         JOIN presentations p ON p.id = a.presentation_id
        WHERE a.id = ? AND a.presentation_id = ? AND p.owner_user_id = ?`,
      [assetId, presId, ownerId]
    );
    const row = chk?.[0];
    if (!row) return reply.code(404).send({ message: 'not_found' });

    await db.execute('DELETE FROM presentation_assets WHERE id = ?', [assetId]);

    try {
      const fs = require('fs');
      if (row.file_path && fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
    } catch {}

    reply.send({ ok: true });
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});

// --- helpers de imágenes / html (sin cambios de SQL) ---
function resolveImagePath(p: any): string | null {
  if (!p) return null;
  const str = String(p);
  try {
    if (fs.existsSync(str)) return str;
    const base = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');

    const clean = str.startsWith('/uploads/')
      ? str.slice('/uploads/'.length)
      : str.startsWith('uploads/')
      ? str.slice('uploads/'.length)
      : str.replace(/^\/+/, '');

    const candidate = path.join(base, clean);
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  return null;
}

const wrapHtml = (html: string) =>
  html.includes("<html")
    ? html
    : `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"></head><body>${html}</body></html>`;

const splitSections = (rawHtml: string): string[] => {
  const html = (rawHtml ?? "").trim();
  if (!html) return [""];
  const parts: string[] = [];
  const re = /<section[\s\S]*?<\/section>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) if (m[0]) parts.push(m[0]);
  return parts.length ? parts : [html];
};

function stripFences(s: string): string {
  if (!s) return "";
  return s.replace(/^[\s`]*html[\s`]*\n?/i, "").replace(/```/g, "").trim();
}

function strictWrap(inner: string): string {
  if (/<html[^>]*>/i.test(inner)) return inner;

  const SLIDE = { w: 1920, h: 1080 } as const;
  const THEME = { bg: "#f5f0e1", text: "#222", sub: "#616161", accent: "#c62828" };

  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{
    --bg:${THEME.bg}; --text:${THEME.text}; --sub:${THEME.sub}; --accent:${THEME.accent};
    --pad:56px; --radius:18px; --shadow:0 18px 42px rgba(0,0,0,.14);
    --w:${SLIDE.w}px; --h:${SLIDE.h}px;
  }
  *{box-sizing:border-box} html,body{height:100%;margin:0}
  body{width:var(--w);height:var(--h);background:var(--bg);color:var(--text);
       font:500 26px/1.38 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  .slide{position:relative;width:100%;height:100%;padding:var(--pad)}
  h1{font:800 72px/1.05 inherit;margin:0 0 12px}
  h2{font:800 52px/1.08 inherit;margin:0 0 12px}
  p{margin:0}
  .muted{color:var(--sub)}
  .row{display:grid;grid-template-columns:repeat(12,1fr);gap:32px;align-items:start}
  .col-7{grid-column:span 7;} .col-5{grid-column:span 5;}
  .col-6{grid-column:span 6;} .col-12{grid-column:span 12;}
  .card{background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:28px}
  .badges{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
  .badge{background:rgba(0,0,0,.06);padding:8px 12px;border-radius:999px;font-size:20px}
  .thumbs{display:flex;flex-wrap:wrap;gap:16px}
  .thumbs img{height:136px;width:auto;border-radius:14px;box-shadow:var(--shadow)}
  .image-box{position:absolute;overflow:hidden;border-radius:16px;box-shadow:var(--shadow)}
  .image-box img{display:block;width:100%;height:100%;object-fit:cover}
  .footer{position:absolute;left:56px;right:56px;bottom:34px;color:#fff;background:#2b2b2bcc;
          padding:12px 18px;border-radius:12px;font-size:22px}
</style>
</head><body><div class="slide">${inner}</div></body></html>`;
}

const seedFrom = (s: string) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const seededRand = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed & 0xfffffff) / 0x10000000;
};

const shuffleInPlace = <T,>(arr: T[], rand: () => number): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
};

async function representativeThumbs(
  db: any,
  ownerId: number,
  items: any[],
  tagIds: number[] | undefined,
  max: number
): Promise<string[]> {
  const fallback = items
    .map((it) => (typeof it.cover === "string" && /^https?:\/\//i.test(it.cover) ? it.cover : ""))
    .filter(Boolean)
    .slice(0, max);

  if (!tagIds || !tagIds.length) return fallback;

  const placeholders = tagIds.map(() => "?").join(",");
  const [rows]: any = await db.execute(
    `SELECT DISTINCT TOP ${max} img.file_path AS url
       FROM item_tags it
       JOIN philatelic_items i ON i.id = it.item_id AND i.owner_user_id = ?
       JOIN item_images img ON img.item_id = i.id
      WHERE it.tag_id IN (${placeholders})
      ORDER BY img.is_primary DESC, img.id ASC`,
    [ownerId, ...tagIds]
  );
  const byTags = (rows || [])
    .map((r: any) => (typeof r.url === "string" && /^https?:\/\//i.test(r.url) ? r.url : ""))
    .filter(Boolean);

  return byTags.length ? byTags : fallback;
}

// ------------------- auth: register -------------------
app.post('/auth/register', async (req: any, reply: any) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password) {
      return reply.code(400).send({ message: 'email y password requeridos' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName  = displayName ? String(displayName).trim() : null;

    // 1) Validar que no exista
    const [exists]: any = await db.execute(
      `SELECT TOP 1 id
         FROM users
        WHERE email = ?`,
      [cleanEmail]
    );
    if (exists?.length) {
      return reply.code(409).send({ message: 'email_ya_registrado' });
    }

    // 2) Crear user
    const hash = await bcrypt.hash(String(password), 10);

    const [result]: any = await db.execute(
      `INSERT INTO users (email, password_hash, display_name, is_active)
       VALUES (?,?,?,1)`,
      [cleanEmail, hash, cleanName || cleanEmail]
    );

    const userId = Number(result?.insertId);

    // 3) (Opcional) asignar rol "user" si existe en tu tabla roles
    try {
      const [roleRows]: any = await db.execute(
        'SELECT TOP 1 id FROM roles WHERE name = ?',
        ['user']
      );
      if (roleRows?.length && Number.isFinite(userId)) {
        await db.execute(
          'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [userId, roleRows[0].id]
        );
      }
    } catch {
      // si no tienes roles/user_roles, no pasa nada
    }

    // 4) Responder (sin token; tú ya tienes /auth/login)
    return reply.code(201).send({
      ok: true,
      user: { id: userId, email: cleanEmail, displayName: cleanName || cleanEmail }
    });
  } catch (e: any) {
    return reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});



// =================== PRESENTATIONS: generate-ppt (SQL adaptado) ===================
app.post(
  "/presentations/:id/generate-ppt",
  { preHandler: authGuard },
  async (req: any, reply: any) => {
    try {
      const ownerId = ensureAuth(req);
      const presId = Number(req.params.id);
      if (!Number.isFinite(presId)) {
        return reply.code(400).send({ message: "id inválido" });
      }

      const [presRows]: any = await db.execute(
        `SELECT TOP 1 p.id,
                        p.title,
                        p.description,
                        p.collection_id AS collectionId
           FROM presentations p
          WHERE p.id = ? AND p.owner_user_id = ?`,
        [presId, ownerId]
      );
      const pres = presRows?.[0];
      if (!pres) return reply.code(404).send({ message: "presentation_not_found" });

      const [colRows]: any = await db.execute(
        `SELECT TOP 1 c.id,
                        c.type,
                        c.filter_json,
                        c.sort_key,
                        c.sort_dir,
                        c.history_text
           FROM collections c
          WHERE c.id = ? AND c.owner_user_id = ?`,
        [pres.collectionId, ownerId]
      );
      const col = colRows?.[0];
      if (!col) return reply.code(404).send({ message: "collection_not_found" });

      const historyText: string = (col.history_text == null ? "" : String(col.history_text)).trim();

      const qLimit = Number(req.query?.maxSlides ?? req.body?.maxSlides);
      const maxSlides =
        Number.isFinite(qLimit) && qLimit > 0 ? Math.min(qLimit, 60) : 30;

      let items: any[] = [];
      if (col.type === "static") {
        const [rows]: any = await db.execute(
          `SELECT TOP ${maxSlides}
                  i.id,
                  i.title,
                  i.country,
                  i.issue_year AS issueYear,
                  i.description,
                  i.catalog_code AS catalogCode,
                  i.face_value AS faceValue,
                  i.currency,
                  (
                    SELECT TOP 1 file_path
                    FROM item_images
                    WHERE item_id = i.id
                    ORDER BY is_primary DESC, id ASC
                  ) AS cover
             FROM collection_items ci
             JOIN philatelic_items i
               ON i.id = ci.item_id
              AND i.owner_user_id = ?
            WHERE ci.collection_id = ?
            ORDER BY i.${col.sort_key || "issue_year"} ${String(
            col.sort_dir || "asc"
          ).toUpperCase()}`,
          [ownerId, col.id]
        );
        items = rows;
      } else {
        let f: any = {};
        try {
          const raw = col.filter_json;
          f = raw == null
            ? {}
            : (typeof raw === "string"
                ? JSON.parse(raw)
                : (Buffer.isBuffer(raw)
                    ? JSON.parse(raw.toString("utf8"))
                    : raw));
        } catch {
          f = {};
        }

        const built: any = buildWhereFromFilter(ownerId, f);
        const { where, params, tagIds, tagNames, tagMode, attrFilters } = built;
        let join = "";

        if (tagIds.length + tagNames.length > 0) {
          let all = [...tagIds];
          if (tagNames.length) {
            const placeholders = tagNames.map(() => "?").join(",");
            const ownerFilter = await tagsOwnerWhere(ownerId);
            const [trs]: any = await db.execute(
              `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
              [...ownerFilter.params, ...tagNames]
            );
            const idsByName = trs.map((r: any) => r.id);
            all = all.concat(idsByName);
          }
          const unique = Array.from(
            new Set(all.map(Number).filter(Number.isFinite))
          );
          if (unique.length) {
            if (String(tagMode || "OR").toUpperCase() === "AND") {
              join += `
                JOIN (
                  SELECT it.item_id
                    FROM item_tags it
                   WHERE it.tag_id IN (${unique
                     .map(() => "?")
                     .join(",")})
                   GROUP BY it.item_id
                  HAVING COUNT(DISTINCT it.tag_id) = ${unique.length}
                ) tfilter ON tfilter.item_id = i.id`;
              params.push(...unique);
            } else {
              join += `
                JOIN item_tags itf
                  ON itf.item_id = i.id
                 AND itf.tag_id IN (${unique.map(() => "?").join(",")})`;
              params.push(...unique);
            }
          }
        }

        const { join: aj, params: ap } = await buildAttrJoins(
          ownerId,
          attrFilters
        );
        join += aj;
        built.params.push(...ap);

        const [rows]: any = await db.execute(
          `SELECT DISTINCT TOP ${maxSlides}
                  i.id,
                  i.title,
                  i.country,
                  i.issue_year AS issueYear,
                  i.description,
                  i.catalog_code AS catalogCode,
                  i.face_value AS faceValue,
                  i.currency,
                  (
                    SELECT TOP 1 file_path
                    FROM item_images
                    WHERE item_id = i.id
                    ORDER BY is_primary DESC, id ASC
                  ) AS cover
             FROM philatelic_items i
             ${join}
            WHERE ${built.where.join(" AND ")}
            ORDER BY i.${col.sort_key || "issue_year"} ${String(
            col.sort_dir || "asc"
          ).toUpperCase()}`,
          built.params
        );
        items = rows;
      }

      const normalizeText = (base: string, fallback: string): string => {
        let txt = (base || "").toString().trim();
        if (!txt) txt = fallback;
        if (txt.length < 25) {
          txt +=
            " Esta sección se incluye como parte de la interpretación de la colección.";
        }
        if (txt.length > 300) {
          txt = txt.slice(0, 296) + "...";
        }
        return txt;
      };

      const splitHistoryByParagraphs = (text: string): string[] => {
        const raw = (text || "").replace(/\r\n/g, "\n").trim();
        if (!raw) return [];
        let parts = raw
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (!parts.length) parts = [raw];
        return parts;
      };

      const layoutId = "modern:image-and-description";
      const slides: any[] = [];

      const fallbackPortadaText =
        "Presentación generada a partir de una colección filatélica seleccionada en la app Filatelia.";

      let portadaContentText = normalizeText(
        pres.description || "",
        fallbackPortadaText
      );

      const portadaRawImg = (pres as any).cover_image_path || items[0]?.cover || null;
      const portadaAbsImg =
        toAbsoluteUrl(portadaRawImg) || portadaRawImg || null;
      const fallbackImgUrl =
        "https://via.placeholder.com/1200x800.png?text=Filatelia";
      const portadaImageUrl = portadaAbsImg || fallbackImgUrl;

      slides.push({
        layout: layoutId,
        content: {
          title: pres.title || "Presentación filatélica",
          content: portadaContentText,
          image: {
            __image_url__: portadaImageUrl,
            __image_prompt__:
              "Portada de colección filatélica para presentación académica",
          },
        },
      });

      const historyBlocks = splitHistoryByParagraphs(historyText);

      if (historyBlocks.length > 0) {
        const merged = historyBlocks.join("\n\n");
        const blocks =
          merged.length <= 400 ? [merged] : historyBlocks;

        const covers: string[] = (items || [])
          .map((it: any) => toAbsoluteUrl(it.cover) || it.cover)
          .filter((u: any): u is string => !!u);

        const historyFallback =
          "Esta colección se organiza en torno a un conjunto de piezas que reflejan procesos políticos y simbólicos en distintos contextos nacionales.";

        blocks.forEach((block, idx) => {
          const title =
            blocks.length === 1
              ? "Historia de la colección"
              : `Historia de la colección (${idx + 1})`;

          const contentText = normalizeText(block, historyFallback);

          const imgIndex =
            covers.length === 0
              ? -1
              : idx < covers.length
              ? idx
              : covers.length - 1;

          const imgUrl =
            imgIndex >= 0 ? covers[imgIndex] : portadaImageUrl;

          let imgPrompt =
            "Sello histórico para slide de contexto filatélico";
          if (items[idx]) {
            const it = items[idx];
            imgPrompt = `Sello ${it.country ?? ""} ${
              it.issueYear ?? ""
            } para historia de la colección`.trim();
          }

          slides.push({
            layout: layoutId,
            content: {
              title,
              content: contentText,
              image: {
                __image_url__: imgUrl || portadaImageUrl,
                __image_prompt__:
                  imgPrompt.slice(0, 50) ||
                  "Sello clásico para contexto filatélico",
              },
            },
          });
        });
      }

      for (const it of items) {
        const metaLine = `País ${it.country ?? ""} • Año ${
          it.issueYear ?? ""
        } • Catálogo ${it.catalogCode ?? ""} • Valor ${
          it.faceValue ?? it.face_value ?? ""
        } ${it.currency ?? ""}`.replace(/\s+/g, " ").trim();

        let itemText =
          it.description && it.description.trim().length > 0
            ? it.description.trim()
            : metaLine || "Pieza de la colección.";

        itemText = normalizeText(
          itemText,
          "Esta pieza se incluye como ejemplo representativo de la colección y resume rasgos iconográficos y políticos propios del periodo estudiado."
        );

        const absImg = toAbsoluteUrl(it.cover);
        const fallbackImgUrlItem =
          "https://via.placeholder.com/1200x800.png?text=Sello";
        const imgUrl = absImg || fallbackImgUrlItem;

        let imgPromptBase = `Sello ${it.country ?? ""} ${
          it.issueYear ?? ""
        } para análisis filatélico`.trim();
        if (imgPromptBase.length > 50) {
          imgPromptBase = imgPromptBase.slice(0, 50);
        }
        if (imgPromptBase.length < 10) {
          imgPromptBase += " sello clásico";
        }

        slides.push({
          layout: layoutId,
          content: {
            title: it.title || `Pieza #${it.id}`,
            content: itemText,
            image: {
              __image_url__: imgUrl,
              __image_prompt__: imgPromptBase,
            },
          },
        });
      }

      if (items.length >= 2) {
        const a = items[0];
        const b = items[1];

        const aCountry = a.country ?? "un país";
        const bCountry = b.country ?? "otro país";
        const aYear = a.issueYear ?? "año desconocido";
        const bYear = b.issueYear ?? "año desconocido";

        let compText = `
Se presenta una comparación entre "${a.title || "la primera pieza"}" (${aCountry}, ${aYear})
y "${b.title || "la segunda pieza"}" (${bCountry}, ${bYear}).

Ambas emisiones comparten la función de difundir una imagen oficial del Estado, pero
difieren en el tratamiento visual (composición, color y jerarquía de símbolos) y en el
momento político al que responden. Estas diferencias permiten contrastar cómo cada
administración construye su relato sobre nación, ciudadanía e integración regional.
`.trim();

        compText = normalizeText(
          compText,
          "Las primeras dos piezas permiten observar continuidades y cambios en la manera en que el Estado representa su proyecto político hacia dentro y hacia fuera del país."
        );

        const compImgRaw = toAbsoluteUrl(a.cover) || a.cover || portadaImageUrl;
        const compImg = compImgRaw || portadaImageUrl;

        slides.push({
          layout: layoutId,
          content: {
            title: "Comparación de piezas seleccionadas",
            content: compText,
            image: {
              __image_url__: compImg,
              __image_prompt__:
                "Sello postal destacado para slide de comparación analítica en contexto filatélico",
            },
          },
        });
      }

      const body = {
        language: "Spanish",
        title: pres.title || "Presentación filatélica",
        template: "modern",
        theme: "edge-yellow",
        export_as: "pptx",
        slides,
      };

      const presentonRes = await createPresentationFromJson(body);

      const [ins]: any = await db.execute(
        `INSERT INTO presentation_assets (presentation_id, kind, file_path, url, meta_json)
         VALUES (?,?,?,?,?)`,
        [
          presId,
          "ppt",
          null,
          presentonRes.path,
          JSON.stringify({
            provider: "presenton",
            presentation_id: presentonRes.presentation_id,
            edit_path: presentonRes.edit_path,
            credits_consumed: presentonRes.credits_consumed,
          }),
        ]
      );

      return reply.send({
        ok: true,
        assetId: ins.insertId,
        download: `/presentations/${presId}/ppt`,
      });
    } catch (e: any) {
      if ((e as any).response) {
        console.error("❌ Presenton /create/from-json error");
        console.error("Status:", (e as any).response.status);
        console.error("Data:", (e as any).response.data);
      }
      req.log?.error(e, "generate-ppt (presenton) failed");
      return reply.code(500).send({
        message: "ppt_generation_failed",
        detail: e?.message ?? "unknown_error",
      });
    }
  }
);

// Devuelve URLs del PPT más reciente
app.get('/presentations/:id/ppt', { preHandler: authGuard }, async (req:any, reply:any) => {
  try {
    const ownerId = ensureAuth(req);
    const presId = Number(req.params.id);
    if (!Number.isFinite(presId)) {
      return reply.code(400).send({ message: 'id inválido' });
    }

    const [p]: any = await db.execute(
      'SELECT TOP 1 id FROM presentations WHERE id = ? AND owner_user_id = ?',
      [presId, ownerId]
    );
    if (!p.length) {
      return reply.code(404).send({ message: 'presentation_not_found' });
    }

    const [a]: any = await db.execute(
      `SELECT TOP 1 id,
                     file_path AS filePath,
                     url,
                     meta_json AS metaJson
         FROM presentation_assets
        WHERE presentation_id = ? AND kind = 'ppt'
        ORDER BY created_at DESC, id DESC`,
      [presId]
    );
    const asset = a?.[0];
    if (!asset) {
      return reply.code(404).send({ message: 'ppt_not_found' });
    }

    let editPath: string | null = null;
    try {
      const raw = asset.metaJson;
      let meta: any = null;

      if (raw) {
        if (typeof raw === 'string') {
          meta = JSON.parse(raw);
        } else if (Buffer.isBuffer(raw)) {
          meta = JSON.parse(raw.toString('utf8'));
        } else if (typeof raw === 'object') {
          meta = raw;
        }
      }

      if (meta && meta.edit_path) {
        editPath = String(meta.edit_path);
      }
    } catch {
      editPath = null;
    }

    const base = process.env.PRESENTON_BASE_URL || 'https://app.presenton.ai';
    let presentonUrl: string | null = null;
    if (editPath) {
      if (/^https?:\/\//i.test(editPath)) {
        presentonUrl = editPath;
      } else {
        const cleanBase = base.replace(/\/+$/, '');
        const cleanPath = editPath.replace(/^\/+/, '');
        presentonUrl = `${cleanBase}/${cleanPath}`;
      }
    }

    return reply.send({
      presentonUrl,
      downloadUrl: asset.url,
      filePath: asset.filePath ?? null
    });
  } catch (e:any) {
    req.log?.error(e, 'download-ppt failed');
    return reply.code(500).send({
      message: 'download_failed',
      detail: e?.message
    });
  }
});

// app.listen({ port: 3000, host: '0.0.0.0' });  en local
app.put(
  '/tags/:id',
  { preHandler: authGuard },
  async (req: any, reply: any) => {
    const conn = await db.getConnection();
    try {
      const ownerId = ensureAuth(req);
      const tagId = Number(req.params.id);
      const name = String(req.body?.name ?? '').trim();

      if (!Number.isFinite(tagId)) return reply.code(400).send({ message: 'tagId inválido' });
      if (!name) return reply.code(400).send({ message: 'name requerido' });

      // (Opcional) evitar duplicados por usuario (case-insensitive)
      const [dup]: any = await conn.execute(
        `SELECT TOP 1 id
         FROM tags
         WHERE owner_user_id = ?
           AND LOWER(name) = LOWER(?)
           AND id <> ?`,
        [ownerId, name, tagId]
      );
      if (dup.length) return reply.code(409).send({ message: 'tag_name_already_exists' });

      const [res]: any = await conn.execute(
        `UPDATE tags
         SET name = ?
         WHERE id = ? AND owner_user_id = ?`,
        [name, tagId, ownerId]
      );

      // mssql/mysql2: res.affectedRows | res.rowsAffected (depende del driver)
      const affected =
        (res?.affectedRows ?? (Array.isArray(res?.rowsAffected) ? res.rowsAffected[0] : res?.rowsAffected)) || 0;

      if (!affected) return reply.code(404).send({ message: 'tag_not_found' });

      const [rows]: any = await conn.execute(
        `SELECT id, name
         FROM tags
         WHERE id = ? AND owner_user_id = ?`,
        [tagId, ownerId]
      );

      return reply.send(rows[0]);
    } catch (e: any) {
      return reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
    } finally {
      try { conn.release?.(); } catch {}
    }
  }
);


app.get('/items/countries', { preHandler: authGuard }, async (req:any, reply:any) => {
  try {
    const ownerId = ensureAuth(req);

    const [rows]: any = await db.execute(
      `SELECT DISTINCT country
       FROM philatelic_items
       WHERE owner_user_id = ?
         AND country IS NOT NULL
         AND LTRIM(RTRIM(country)) <> ''
       ORDER BY country`,
      [ownerId]
    );

    reply.send(rows.map((r:any) => r.country));
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


app.get('/items/conditions', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);

    const [rows]: any = await db.execute(
      `SELECT DISTINCT condition_code
       FROM philatelic_items
       WHERE owner_user_id = ?
         AND condition_code IS NOT NULL
         AND LTRIM(RTRIM(condition_code)) <> ''
       ORDER BY condition_code`,
      [ownerId]
    );

    reply.send(rows.map((r: any) => r.condition_code));
  } catch (e: any) {
    reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


app.get('/collections/:id/tags', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const colId = Number(req.params.id);
    if (!Number.isFinite(colId)) return reply.code(400).send({ message: 'id inválido' });

    const [crows]: any = await db.execute(
      `SELECT TOP 1 id, type, filter_json
         FROM collections
        WHERE id = ? AND owner_user_id = ?`,
      [colId, ownerId]
    );
    const col = crows?.[0];
    if (!col) return reply.code(404).send({ message: 'collection_not_found' });

    let join = '';
    const joinParams: any[] = [];

    let smartWhere: string[] = [];
    let smartWhereParams: any[] = [];

    if (String(col.type).toLowerCase() === 'static') {
      join = `JOIN collection_items ci ON ci.item_id = i.id AND ci.collection_id = ?`;
      joinParams.push(colId);
    } else {
      let f: any = {};
      try {
        const raw = col.filter_json;
        f = raw == null ? {} : (typeof raw === 'string'
          ? JSON.parse(raw)
          : (Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : raw));
      } catch { f = {}; }

      const built = buildWhereFromFilter(ownerId, f);
      const { where, params: whereParams, tagIds, tagNames, tagMode, attrFilters } = built;

      smartWhere = where || [];
      smartWhereParams = whereParams || [];

      let baseJoin = '';
      const baseParams: any[] = [];

      // filtros de tags del SMART (si existieran)
      if ((tagIds.length + tagNames.length) > 0) {
        let allTagIds = [...tagIds];

        if (tagNames.length) {
          const placeholders = tagNames.map(() => '?').join(',');
          // OJO: aquí también puede romper si tagsOwnerWhere no usa alias.
          // Mejor: resolver tags por owner directamente
          const [trs]: any = await db.execute(
            `SELECT id FROM tags WHERE owner_user_id = ? AND name IN (${placeholders})`,
            [ownerId, ...tagNames]
          );
          allTagIds = allTagIds.concat(trs.map((r: any) => r.id));
        }

        const uniqueIds = Array.from(new Set(allTagIds.map(Number).filter(Number.isFinite)));

        if (uniqueIds.length) {
          if (String(tagMode || 'OR').toUpperCase() === 'AND') {
            baseJoin += `
              JOIN (
                SELECT it.item_id
                  FROM item_tags it
                 WHERE it.tag_id IN (${uniqueIds.map(() => '?').join(',')})
                 GROUP BY it.item_id
                HAVING COUNT(DISTINCT it.tag_id) = ${uniqueIds.length}
              ) tfilter ON tfilter.item_id = i.id
            `;
            baseParams.push(...uniqueIds);
          } else {
            baseJoin += `
              JOIN item_tags itf
                ON itf.item_id = i.id
               AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})
            `;
            baseParams.push(...uniqueIds);
          }
        }
      }

      const { join: attrJoin, params: attrParams } = await buildAttrJoins(ownerId, attrFilters);
      baseJoin += attrJoin;
      baseParams.push(...attrParams);

      join = baseJoin;
      joinParams.push(...baseParams);
    }

    // ✅ IMPORTANTE: filtro correcto por owner en tags usando alias "t"
    const sql = `
      SELECT DISTINCT t.id, t.name
      FROM philatelic_items i
      ${join}
      JOIN item_tags it ON it.item_id = i.id
      JOIN tags t ON t.id = it.tag_id
      WHERE i.owner_user_id = ?
        AND t.owner_user_id = ?
        ${smartWhere.length ? `AND ${smartWhere.join(' AND ')}` : ''}
      ORDER BY t.name ASC
    `;

    // ✅ orden: params del JOIN primero (porque aparecen antes en el SQL), luego WHERE
    const allParams = [...joinParams, ownerId, ownerId, ...smartWhereParams];

    const [rows]: any = await db.execute(sql, allParams);
    return reply.send(rows || []);
  } catch (e: any) {
    // para ver el error real en Azure logs:
    // console.error('[GET /collections/:id/tags]', e);
    return reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


app.get('/collections/:id/attributes', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const colId = Number(req.params.id);
    if (!Number.isFinite(colId)) return reply.code(400).send({ message: 'id inválido' });

    const [crows]: any = await db.execute(
      `SELECT TOP 1 id, type, filter_json
         FROM collections
        WHERE id = ? AND owner_user_id = ?`,
      [colId, ownerId]
    );
    const col = crows?.[0];
    if (!col) return reply.code(404).send({ message: 'collection_not_found' });

    let join = '';
    const params: any[] = [];

    if (String(col.type).toLowerCase() === 'static') {
      join = `JOIN collection_items ci ON ci.item_id = i.id AND ci.collection_id = ?`;
      params.push(colId);
    } else {
      let f: any = {};
      try {
        const raw = col.filter_json;
        f = raw == null ? {} : (typeof raw === 'string'
          ? JSON.parse(raw)
          : (Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : raw));
      } catch { f = {}; }

      const built = buildWhereFromFilter(ownerId, f);
      const { where, params: whereParams, tagIds, tagNames, tagMode, attrFilters } = built;

      let baseJoin = '';
      const baseParams: any[] = [];

      if ((tagIds.length + tagNames.length) > 0) {
        let allTagIds = [...tagIds];

        if (tagNames.length) {
          const placeholders = tagNames.map(() => '?').join(',');
          const ownerFilter = await tagsOwnerWhere(ownerId);
          const [trs]: any = await db.execute(
            `SELECT id FROM tags WHERE ${ownerFilter.where} AND name IN (${placeholders})`,
            [...ownerFilter.params, ...tagNames]
          );
          allTagIds = allTagIds.concat(trs.map((r: any) => r.id));
        }

        const uniqueIds = Array.from(new Set(allTagIds.map(Number).filter(Number.isFinite)));
        if (uniqueIds.length) {
          if (String(tagMode || 'OR').toUpperCase() === 'AND') {
            baseJoin += `
              JOIN (
                SELECT it.item_id
                  FROM item_tags it
                 WHERE it.tag_id IN (${uniqueIds.map(() => '?').join(',')})
                 GROUP BY it.item_id
                HAVING COUNT(DISTINCT it.tag_id) = ${uniqueIds.length}
              ) tfilter ON tfilter.item_id = i.id
            `;
            baseParams.push(...uniqueIds);
          } else {
            baseJoin += `
              JOIN item_tags itf
                ON itf.item_id = i.id
               AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})
            `;
            baseParams.push(...uniqueIds);
          }
        }
      }

      const { join: aj, params: ap } = await buildAttrJoins(ownerId, attrFilters);
      baseJoin += aj;
      baseParams.push(...ap);

      join = `${baseJoin}`;

      (req as any).__smartWhere = where;
      (req as any).__smartWhereParams = whereParams;
      params.push(...baseParams);
    }

    const smartWhere: string[] = (req as any).__smartWhere || [];
    const smartWhereParams: any[] = (req as any).__smartWhereParams || [];

    const sql = `
      SELECT DISTINCT
        ad.id,
        ad.name,
        ad.attr_type AS attrType,
        ad.options_json AS optionsJson,
        ad.created_at AS createdAt
      FROM philatelic_items i
      ${join}
      JOIN item_attributes ia ON ia.item_id = i.id
      JOIN attribute_definitions ad ON ad.id = ia.attribute_id
      WHERE i.owner_user_id = ?
        AND ad.owner_user_id = ?
        ${smartWhere.length ? `AND ${smartWhere.join(' AND ')}` : ''}
      ORDER BY ad.name ASC
    `;

    // ✅ FIX: params del JOIN primero
    const allParams = [...params, ownerId, ownerId, ...smartWhereParams];

    const [rows]: any = await db.execute(sql, allParams);
    return reply.send(rows || []);
  } catch (e: any) {
    return reply.code(500).send({ message: e?.message || 'Ha ocurrido un error, por favor contactar con soporte' });
  }
});


app.get('/collections/:id/countries', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const colId = Number(req.params.id);
    if (!Number.isFinite(colId)) return reply.code(400).send({ message: 'id inválido' });

    const [crows]: any = await db.execute(
      `SELECT TOP 1 id, type, filter_json
         FROM collections
        WHERE id = ? AND owner_user_id = ?`,
      [colId, ownerId]
    );
    const col = crows?.[0];
    if (!col) return reply.code(404).send({ message: 'collection_not_found' });

    let join = '';
    const joinParams: any[] = [];
    let smartWhere: string[] = [];
    let smartWhereParams: any[] = [];

    if (String(col.type).toLowerCase() === 'static') {
      join = `JOIN collection_items ci ON ci.item_id = i.id AND ci.collection_id = ?`;
      joinParams.push(colId);
    } else {
      let f: any = {};
      try {
        const raw = col.filter_json;
        f = raw == null ? {} : (typeof raw === 'string'
          ? JSON.parse(raw)
          : (Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : raw));
      } catch { f = {}; }

      const built = buildWhereFromFilter(ownerId, f);
      const { where, params: whereParams, tagIds, tagNames, tagMode, attrFilters } = built;

      smartWhere = where || [];
      smartWhereParams = whereParams || [];

      let baseJoin = '';
      const baseParams: any[] = [];

      // Si el filtro SMART incluye tags, aplica el mismo join-filter
      if ((tagIds.length + tagNames.length) > 0) {
        let allTagIds = [...tagIds];

        if (tagNames.length) {
          const placeholders = tagNames.map(() => '?').join(',');
          const [trs]: any = await db.execute(
            `SELECT id FROM tags WHERE owner_user_id = ? AND name IN (${placeholders})`,
            [ownerId, ...tagNames]
          );
          allTagIds.push(...(trs || []).map((r: any) => r.id));
        }

        const uniqueIds = Array.from(new Set(allTagIds.map(Number).filter(Number.isFinite)));
        if (uniqueIds.length) {
          if (String(tagMode || 'OR').toUpperCase() === 'AND') {
            baseJoin += `
              JOIN (
                SELECT it.item_id
                  FROM item_tags it
                 WHERE it.tag_id IN (${uniqueIds.map(() => '?').join(',')})
                 GROUP BY it.item_id
                HAVING COUNT(DISTINCT it.tag_id) = ${uniqueIds.length}
              ) tfilter ON tfilter.item_id = i.id
            `;
            baseParams.push(...uniqueIds);
          } else {
            baseJoin += `
              JOIN item_tags itf
                ON itf.item_id = i.id
               AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})
            `;
            baseParams.push(...uniqueIds);
          }
        }
      }

      // Si el filtro SMART incluye attrs, usa tus joins (ojo: que buildAttrJoins esté alineado a tu esquema)
      const { join: attrJoin, params: attrParams } = await buildAttrJoins(ownerId, attrFilters);
      baseJoin += attrJoin;
      baseParams.push(...attrParams);

      join = baseJoin;
      joinParams.push(...baseParams);
    }

    const sql = `
      SELECT DISTINCT i.country AS country
      FROM philatelic_items i
      ${join}
      WHERE i.owner_user_id = ?
        AND i.country IS NOT NULL
        AND LTRIM(RTRIM(i.country)) <> ''
        ${smartWhere.length ? `AND ${smartWhere.join(' AND ')}` : ''}
      ORDER BY i.country ASC
    `;

    const allParams = [...joinParams, ownerId, ...smartWhereParams];
    const [rows]: any = await db.execute(sql, allParams);

    // devolver solo string[]
    return reply.send((rows || []).map((r: any) => r.country));
  } catch (e: any) {
    req.log?.error(e, 'Error en GET /collections/:id/countries');
    return reply.code(500).send({ message: e?.message || 'internal_error' });
  }
});

//en azure
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    app.log.info(`Server listening on http://${HOST}:${PORT}`);
  })
  .catch((err: any) => {
    app.log.error(err, 'Error starting server');
    process.exit(1);
  });



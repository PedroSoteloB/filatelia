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

// ------------------- ITEMS -------------------
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
          try { meta = JSON.parse(String(p.value ?? '{}')); }
          catch { return reply.code(400).send({ message: 'metadata inválido (JSON)' }); }
          continue;
        }

        if (p?.type === 'file') {
          if (files.length >= maxImages) { await p.file?.resume?.(); continue; }
          const buf = await p.toBuffer();
          const filename = String(p.filename ?? 'image');
          const mime = String(p.mimetype ?? '');
          if (!buf?.length) continue;
          if (!allowed.has(mime)) return reply.code(400).send({ message: 'Formato no soportado (JPG/PNG/WEBP/GIF)' });
          files.push({ buffer: buf, filename, mime });
          continue;
        }
      }
    } else {
      meta = req.body || null;
    }

    const allowNoImages =
      process.env.ALLOW_ITEMS_WITHOUT_IMAGES === '1' ||
      meta?.allowNoImages === true ||
      String(req.query?.allowNoImages || '').toLowerCase() === 'true';

    if (!meta || !meta.title || !String(meta.title).trim()) {
      return reply.code(400).send({ message: 'metadata.title requerido' });
    }
    if (!files.length && !allowNoImages) {
      return reply.code(400).send({ message: 'al menos una imagen requerida' });
    }

    const visibility = 'public';

    const [rIns]: any = await db.execute(
      `INSERT INTO philatelic_items
         (owner_user_id, title, description, country, issue_year, condition_code,
          catalog_code, face_value, currency, acquisition_date, visibility)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ownerId,
        String(meta.title).trim(),
        meta.description || null,
        meta.country || null,
        meta.issueYear ?? null,
        meta.condition || null,
        meta.catalogCode || null,
        meta.faceValue ?? null,
        meta.currency || null,
        meta.acquisitionDate || null,
        visibility
      ]
    );

    const itemId: number = Number(rIns.insertId);

    if (files.length) {
      const fs = require('fs');
      const path = require('path');
      const base = process.env.FILES_BASE_PATH || path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });

      for (const [i, f] of files.entries()) {
        const safeName = `${itemId}-${Date.now()}-${i}-${f.filename}`.replace(/[^\w.\-]+/g, '_');
        const fullPath = path.join(base, safeName);
        fs.writeFileSync(fullPath, f.buffer);
        await db.execute(
          'INSERT INTO item_images (item_id, file_path, is_primary) VALUES (?,?,?)',
          [itemId, fullPath, i === 0 ? 1 : 0]
        );
      }
    }

    if (Array.isArray(meta?.tags) && meta.tags.length) {
      const tagNames: string[] = meta.tags.map((t: any) => String(t ?? '').trim()).filter(Boolean);
      const ids: number[] = [];
      for (const name of tagNames) {
        const [ex]: any = await db.execute(
          'SELECT TOP 1 id FROM tags WHERE owner_user_id = ? AND name = ?',
          [ownerId, name]
        );
        if (ex.length) ids.push(Number(ex[0].id));
        else {
          const [ins]: any = await db.execute(
            'INSERT INTO tags (name, owner_user_id) VALUES (?,?)',
            [name, ownerId]
          );
          ids.push(Number(ins.insertId));
        }
      }
      for (const tid of Array.from(new Set(ids))) {
        await db.execute(
          'INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)',
          [itemId, tid]
        );
      }
    }

    if (Array.isArray(meta?.categories) && meta.categories.length) {
      for (const c of meta.categories) {
        if (!c || !c.name) continue;
        const attrName = String(c.name).trim();
        if (!attrName) continue;

        let attrId: number | null = null;
        const [exA]: any = await db.execute(
          'SELECT TOP 1 id FROM attribute_definitions WHERE owner_user_id = ? AND name = ?',
          [ownerId, attrName]
        );
        if (exA.length) {
          attrId = Number(exA[0].id);
        } else {
          const aType = ['text','number','date','list'].includes(String(c.attrType)) ? String(c.attrType) : 'text';
          const [insA]: any = await db.execute(
            'INSERT INTO attribute_definitions (owner_user_id, name, attr_type) VALUES (?,?,?)',
            [ownerId, attrName, aType]
          );
          attrId = Number(insA.insertId);
        }
        if (!attrId) continue;

        const v = c.value;
        const vText = (typeof v === 'string') ? v : null;
        const vNum  = (typeof v === 'number') ? v : (Number.isFinite(Number(v)) ? Number(v) : null);
        const vDate = (c.attrType === 'date' && v) ? v : null;

        await db.execute(
          'DELETE FROM item_attributes WHERE item_id = ? AND attribute_id = ?',
          [itemId, attrId]
        );
        await db.execute(
          `INSERT INTO item_attributes (item_id, attribute_id, value_text, value_number, value_date)
           VALUES (?,?,?,?,?)`,
          [itemId, attrId, vText ?? null, vNum ?? null, vDate ?? null]
        );
      }
    }

    reply.send({ id: itemId });
  } catch (e: any) {
    if (e?.message === 'UNAUTHORIZED') return reply.code(401).send({ message: 'unauthorized' });
    req.log?.error(e);
    reply.code(500).send({ message: e?.message || 'internal_error' });
  }
});

// GET /me/items
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

  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
});

// /items/search
app.get('/items/search', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const q: any = req.query || {};
    const attrs = parseJsonSafely(q.attrs, undefined);

    const f = {
      q: q.q, country: q.country, condition: q.condition,
      yearFrom: q.yearFrom ? Number(q.yearFrom) : undefined,
      yearTo:   q.yearTo   ? Number(q.yearTo)   : undefined,
      tagIds: Array.isArray(q.tagIds) ? q.tagIds : (q.tagIds ? [q.tagIds] : []),
      tagNames: Array.isArray(q.tagNames) ? q.tagNames : (q.tagNames ? [q.tagNames] : []),
      tagsMode: q.tagsMode,
      attrs
    };

    const { where, params: whereParams, tagIds, tagNames, tagMode, attrFilters } =
      buildWhereFromFilter(ownerId, f);

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
        allTagIds = allTagIds.concat(trs.map((r: any) => r.id));
      }

      const uniqueIds = Array.from(new Set(allTagIds.map(Number).filter(Number.isFinite)));
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

    const { join: attrJoin, params: attrParams } = await buildAttrJoins(ownerId, attrFilters);
    join += attrJoin;
    joinParams.push(...attrParams);

    const offset = Number.isFinite(Number(q.offset)) && Number(q.offset) >= 0 ? Number(q.offset) : 0;
    const limit  = Number.isFinite(Number(q.limit))  && Number(q.limit)  >  0 ? Number(q.limit)  : 20;

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
        ) AS cover
      FROM philatelic_items i
      ${join}
      WHERE ${where.join(' AND ')}
      ORDER BY createdAt DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    const [rows]: any = await db.execute(sql, [...joinParams, ...whereParams]);
    const out = rows.map((r: any) => ({ ...r, cover: toPublicUrl(r.cover) }));
    reply.send(out);
  } catch (e:any) {
    if (e.message === 'UNAUTHORIZED') return reply.code(401).send({ message: 'unauthorized' });
    reply.code(500).send({ message: e?.message || 'internal_error' });
  }
});

// GET /items/:id
app.get('/items/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) return reply.code(400).send({ message: 'id inválido' });

    // SQL SERVER: sin JSON_ARRAYAGG, hacemos 2 queries
    const [rows]: any = await db.execute(
      `SELECT *
         FROM philatelic_items
        WHERE id = ? AND owner_user_id = ?`,
      [itemId, ownerId]
    );
    const item = rows?.[0];
    if (!item) return reply.code(404).send({ message: 'not_found' });

    const [imgRows]: any = await db.execute(
      `SELECT id,
             file_path AS [file], 
              is_primary AS [primary]
         FROM item_images
        WHERE item_id = ?
        ORDER BY is_primary DESC, id ASC`,
      [itemId]
    );

    item.images = (imgRows || []).map((im: any) => ({
      ...im,
      file: toPublicUrl(im.file)
    }));

    reply.send(item);
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
});

app.delete('/tags/:id', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    await db.execute('DELETE FROM item_tags WHERE tag_id = ?', [id]);
    await db.execute('DELETE FROM tags WHERE id = ?', [id]);
    reply.send({ ok: true });
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
});

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
    reply.send(rows);
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
});

// ------------------- COLLECTIONS -------------------
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
});

app.get('/collections', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const [rows]: any = await db.execute(
      `SELECT id,
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
         FROM collections
        WHERE owner_user_id = ?
          AND parent_collection_id IS NULL
        ORDER BY created_at DESC`,
      [ownerId]
    );
    reply.send(rows);
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'internal_error' });
  }
});

app.get('/collections/:id/items', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    if (req.method === 'GET' && req.body != null) {
      try { req.log?.warn({ bodyType: typeof req.body }, 'GET con body recibido; se ignora'); } catch {}
      // @ts-ignore
      req.body = undefined;
    }

    const ownerId = ensureAuth(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ message: 'id inválido' });

    const [rows]: any = await db.execute(
      `SELECT TOP 1 id, type, filter_json, sort_key, sort_dir
         FROM collections
        WHERE id = ? AND owner_user_id = ?`,
      [id, ownerId]
    );
    const col = rows?.[0];
    if (!col) return reply.code(404).send({ message: 'not_found' });

    let items: any[] = [];

    if (col.type === 'static') {
      const [is]: any = await db.execute(
        `SELECT i.id,
                i.title,
                i.country,
                i.issue_year AS issueYear,
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
          ORDER BY i.${col.sort_key || 'issue_year'} ${String(col.sort_dir || 'asc').toUpperCase()}`,
        [ownerId, id]
      );
      items = is;
    } else {
      let f: any = {};
      try {
        const raw = col.filter_json;
        if (raw == null || raw === '') f = {};
        else if (typeof raw === 'string') f = JSON.parse(raw);
        else if (Buffer.isBuffer(raw)) f = JSON.parse(raw.toString('utf8'));
        else if (typeof raw === 'object') f = raw;
        else f = {};
      } catch {
        f = {};
      }

      const { where, params, tagIds, tagNames, tagMode, attrFilters } = buildWhereFromFilter(ownerId, f);
      let join = '';

      if ((tagIds.length + tagNames.length) > 0) {
        let allTagIds = [...tagIds];

        if (tagNames.length) {
          const placeholders = tagNames.map(() => '?').join(',');
          const ownerFilter = await tagsOwnerWhere(ownerId);
          const [trs]: any = await db.execute(
            `SELECT id
               FROM tags
              WHERE ${ownerFilter.where}
                AND name IN (${placeholders})`,
            [...ownerFilter.params, ...tagNames]
          );
          allTagIds = allTagIds.concat(trs.map((r: any) => r.id));
        }

        const uniqueIds = Array.from(new Set(allTagIds.map(Number).filter(Number.isFinite)));
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
            params.push(...uniqueIds);
          } else {
            join += `
              JOIN item_tags itf
                ON itf.item_id = i.id
               AND itf.tag_id IN (${uniqueIds.map(() => '?').join(',')})`;
            params.push(...uniqueIds);
          }
        }
      }

      const { join: attrJoin, params: attrParams } = await buildAttrJoins(ownerId, attrFilters);
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
               ) AS cover
          FROM philatelic_items i
          ${join}
         WHERE ${where.join(' AND ')}
         ORDER BY i.${col.sort_key || 'issue_year'} ${String(col.sort_dir || 'asc').toUpperCase()}`;

      const [is]: any = await db.execute(sql, params);
      items = is;
    }

    const out = items.map((r:any) => ({ ...r, cover: toPublicUrl(r.cover) }));
    reply.send(out);
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

    if (!Number.isFinite(colId) || !Number.isFinite(Number(itemId))) {
      return reply.code(400).send({ message: 'parámetros inválidos' });
    }

    // Colección (SQL Server: TOP 1 en vez de LIMIT 1)
    const [colRows]: any = await db.execute(
      'SELECT TOP 1 id, type FROM collections WHERE id = ? AND owner_user_id = ?',
      [colId, ownerId]
    );
    if (!colRows.length) {
      return reply.code(404).send({ message: 'collection_not_found' });
    }
    if (colRows[0].type !== 'static') {
      return reply.code(400).send({ message: 'solo para colecciones estáticas' });
    }

    // Item (también TOP 1)
    const [itemRows]: any = await db.execute(
      'SELECT TOP 1 id FROM philatelic_items WHERE id = ? AND owner_user_id = ?',
      [itemId, ownerId]
    );
    if (!itemRows.length) {
      return reply.code(404).send({ message: 'item_not_found' });
    }

    // INSERT IGNORE versión SQL Server
    await db.execute(
      `INSERT INTO collection_items (collection_id, item_id)
       SELECT ?, ?
       WHERE NOT EXISTS (
         SELECT 1
           FROM collection_items
          WHERE collection_id = ? AND item_id = ?
       )`,
      [colId, itemId, colId, itemId]
    );

    return reply.send({ ok: true });
  } catch (e: any) {
    console.error('❌ POST /collections/:id/items error:', e);
    return reply.code(500).send({ message: e?.message || 'internal_error' });
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
  } catch (e:any) { reply.code(500).send({ message: e?.message || 'internal_error' }); }
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
    reply.code(500).send({ message: e?.message || 'internal_error' });
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
    reply.code(500).send({ message: e?.message || 'internal_error' });
  }
});

// ------------------- SUB-BÚSQUEDA EN COLECCIÓN -------------------
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
    reply.send(rows);
  } catch (e:any) {
    if (e?.message === 'UNAUTHORIZED') return reply.code(401).send({ message: 'unauthorized' });
    req.log?.error(e);
    reply.code(500).send({ message: e?.message || 'internal_error' });
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
        .send({ message: e?.message || 'internal_error' });
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
    reply.code(500).send({ message: e?.message || 'internal_error' });
  }
});

app.get('/presentations', { preHandler: authGuard }, async (req: any, reply: any) => {
  try {
    const ownerId = ensureAuth(req);
    const q = req.query || {};
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
    reply.send(rows);
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'internal_error' });
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
    reply.send(rows[0]);
  } catch (e:any) {
    reply.code(500).send({ message: e?.message || 'internal_error' });
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
    reply.code(500).send({ message: e?.message || 'internal_error' });
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
    reply.code(500).send({ message: e?.message || 'internal_error' });
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
    reply.code(500).send({ message: e?.message || 'internal_error' });
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
    reply.code(500).send({ message: e?.message || 'internal_error' });
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



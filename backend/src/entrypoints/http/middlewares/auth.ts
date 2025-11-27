// src/entrypoints/http/middlewares/auth.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt = require('jsonwebtoken'); // CJS correcto

// augment Fastify
declare module 'fastify' {
  interface FastifyRequest { user?: any; }
}

function getBearer(req: FastifyRequest): string | null {
  const h = req.headers['authorization'] || '';
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = getBearer(req);
  if (!token) return reply.code(401).send({ message: 'no autorizado' });

  try {
    const secret = process.env.JWT_SECRET || 'devsecret';
    const payload = jwt.verify(token, secret);
    req.user = payload;
  } catch {
    return reply.code(401).send({ message: 'token inválido' });
  }
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const r = req.user?.role ?? req.user?.roles ?? req.user?.permissions ?? [];
  const email = (req.user?.email || '').toLowerCase();

  const isAdmin =
    r === 'admin' ||
    (Array.isArray(r) && r.includes('admin')) ||
    email === 'admin@local.test'; // fallback temporal

  if (!isAdmin) return reply.code(403).send({ message: 'solo admin' });
}

// 👇 Exporta al estilo CommonJS
export = { requireAuth, requireAdmin };

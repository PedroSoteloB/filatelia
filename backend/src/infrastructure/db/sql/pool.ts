// // src/infrastructure/db/mysql/pool.ts
// const dotenv = require('dotenv');
// dotenv.config();

// const mysql = require('mysql2/promise');

// const db = mysql.createPool({
//   host: process.env.DB_HOST || 'localhost',
//   port: parseInt(process.env.DB_PORT || '3306', 10),
//   user: process.env.DB_USER || 'root',
//   password: process.env.DB_PASS || '',   // 👈 importante
//   database: process.env.DB_NAME || 'philately',
//   waitForConnections: true,
//   connectionLimit: 10,
// });

// module.exports = { db };

// src/infrastructure/db/mysql/pool.ts
// src/infrastructure/db/mysql/pool.ts
import dotenv from 'dotenv';
dotenv.config();

import sql from 'mssql';

// ⚙️ Config de Azure SQL
const config: sql.config = {
  user: process.env.DB_USER || 'sqlAdmin',
  password: process.env.DB_PASS || 'Programacion2001@',
  server: process.env.DB_HOST || 'databasefilatelia.database.windows.net',
  database: process.env.DB_NAME || 'philately',
  port: Number(process.env.DB_PORT || '1433'),
  connectionTimeout: 60000,   // ⬅️ espera hasta 60 s para conectar
  requestTimeout: 60000,      // ⬅️ (opcional, mismo criterio)
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

console.log('🔧 Azure SQL config:', {
  server: config.server,
  database: config.database,
  user: config.user,
  port: config.port,
});

// Pool global
const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then((pool) => {
    console.log('✅ Conectado a Azure SQL (philately)');
    return pool;
  })
  .catch((err) => {
    console.error('❌ Error al conectar a Azure SQL:', err);
    throw err;
  });

/**
 * Reemplaza los '?' por @p0, @p1, @p2, ...
 */
function replaceQuestionMarks(sqlText: string, paramsCount: number): string {
  let idx = 0;
  return sqlText.replace(/\?/g, () => {
    if (idx >= paramsCount) {
      // si hay más '?' que parámetros, lo dejo como '?' (para que el error sea obvio)
      return '?';
    }
    const name = `p${idx++}`;
    return `@${name}`;
  });
}

/**
 * Inserta "OUTPUT inserted.id AS insertId" en INSERTs para poder leer insertId,
 * asumiendo que la PK se llama "id" y es IDENTITY.
 */
function rewriteInsertForIdentity(text: string): string {
  const re = /^(\s*INSERT\s+INTO\s+\S+\s*\([^)]*\)\s*)(VALUES\s*\()/i;
  if (re.test(text)) {
    return text.replace(re, '$1 OUTPUT inserted.id AS insertId $2');
  }
  return text;
}

type SqlKind = 'select' | 'insert' | 'update' | 'delete' | 'other';

function classifySql(text: string): SqlKind {
  const t = text.trim().toUpperCase();
  if (t.startsWith('SELECT') || t.startsWith('WITH ')) return 'select';
  if (t.startsWith('INSERT')) return 'insert';
  if (t.startsWith('UPDATE')) return 'update';
  if (t.startsWith('DELETE')) return 'delete';
  return 'other';
}

/**
 * Crea un ejecutor que imita mysql2:
 *   const [rows] = await execute('SELECT ...', params)
 *   const [res]  = await execute('INSERT ...', params); res.insertId, res.affectedRows
 */
function makeExecutor(getRequest: () => sql.Request) {
  return async function exec(text: string, params: any[] = []): Promise<[any, any]> {
    const kind = classifySql(text);
    let finalSql = text;

    if (kind === 'insert') {
      finalSql = rewriteInsertForIdentity(text);
    }

    const sqlWithParams = replaceQuestionMarks(finalSql, params.length);
    const request = getRequest();

    params.forEach((val, idx) => {
      request.input(`p${idx}`, val as any);
    });

    try {
      const result = await request.query(sqlWithParams);

      if (kind === 'select') {
        // SELECT → [rows, raw]
        return [result.recordset || [], result];
      }

      if (kind === 'insert') {
        const rows = result.recordset || [];
        const info: any = {
          insertId: rows[0]?.insertId ?? rows[0]?.id ?? null,
          affectedRows: Array.isArray(result.rowsAffected)
            ? result.rowsAffected.reduce((a, b) => a + b, 0)
            : 0,
        };
        return [info, result];
      }

      if (kind === 'update' || kind === 'delete') {
        const info: any = {
          affectedRows: Array.isArray(result.rowsAffected)
            ? result.rowsAffected.reduce((a, b) => a + b, 0)
            : 0,
        };
        return [info, result];
      }

      // Otros casos
      return [result.recordset || [], result];
    } catch (err) {
      // 🔍 Debug opcional
      if (process.env.DB_DEBUG === '1') {
        console.error('❌ SQL ERROR');
        console.error('SQL:', sqlWithParams);
        console.error('PARAMS:', params);
        console.error(err);
      }
      throw err;
    }
  };
}

/**
 * db.execute / db.query fuera de transacción explícita
 */
async function execute(text: string, params: any[] = []): Promise<[any, any]> {
  const pool = await poolPromise;
  const run = makeExecutor(() => pool.request());
  return run(text, params);
}

async function query(text: string, params: any[] = []): Promise<[any, any]> {
  return execute(text, params);
}

/**
 * getConnection "compatible" con tu server.ts:
 *
 * const conn = await db.getConnection();
 * await conn.beginTransaction();
 * const [r] = await conn.execute('INSERT ...', [...]);
 * await conn.commit();
 * conn.release();
 */
async function getConnectionCompat() {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  let inTx = false;

  const run = makeExecutor(() =>
    inTx ? new sql.Request(tx) : pool.request()
  );

  return {
    async beginTransaction() {
      if (!inTx) {
        await tx.begin();
        inTx = true;
      }
    },
    async commit() {
      if (inTx) {
        await tx.commit();
        inTx = false;
      }
    },
    async rollback() {
      if (inTx) {
        await tx.rollback();
        inTx = false;
      }
    },
    async execute(text: string, params: any[] = []) {
      return run(text, params);
    },
    async query(text: string, params: any[] = []) {
      return run(text, params);
    },
    release() { /* no-op para ser compatible */ },
  };
}

// Objeto que exportamos (mismo contrato que mysql2)
const db = {
  query,
  execute,
  getConnection: getConnectionCompat,
};

// 👈 IMPORTANTE: así lo espera tu require: const { db } = require('...')
module.exports = { db };

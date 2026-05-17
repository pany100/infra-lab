const express = require("express");
const { Pool } = require("pg");
const Redis = require("ioredis");
const os = require("os");

const app = express();
const PORT = 3000;
const HOSTNAME = os.hostname();

app.set("trust proxy", true);
app.use(express.json());

// ─────────────────────────────────────────────
// Dos pools: primary (writes) y replica (reads)
// ─────────────────────────────────────────────
const primaryPool = new Pool({
  host: process.env.DB_PRIMARY_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const replicaPool = new Pool({
  host: process.env.DB_REPLICA_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Redis
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

// Rate limit middleware (igual que antes)
function rateLimit({ limit, windowSeconds, keyPrefix }) {
  return async (req, res, next) => {
    const ip = req.ip;
    const key = `ratelimit:${keyPrefix}:${ip}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      const ttl = await redis.ttl(key);
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - count));
      res.setHeader("X-RateLimit-Reset", ttl);
      if (count > limit) {
        return res
          .status(429)
          .json({
            error: "Too Many Requests",
            retryAfter: ttl,
            replica: HOSTNAME,
          });
      }
      next();
    } catch (err) {
      console.error("Rate limit error:", err.message);
      next();
    }
  };
}

// ─────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ ok: true, replica: HOSTNAME });
});

// GET usuarios → lee del REPLICA
app.get("/usuarios", async (req, res) => {
  try {
    const result = await replicaPool.query(
      "SELECT * FROM usuarios ORDER BY id",
    );
    res.json({
      ok: true,
      replica: HOSTNAME,
      source: "db-replica",
      data: result.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST usuarios → escribe en el PRIMARY
app.post("/usuarios", async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: "Falta el campo nombre" });
    }
    const result = await primaryPool.query(
      "INSERT INTO usuarios (nombre) VALUES ($1) RETURNING *",
      [nombre],
    );
    res.status(201).json({
      ok: true,
      replica: HOSTNAME,
      source: "db-primary",
      data: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rate limit
const loginRateLimit = rateLimit({
  limit: 5,
  windowSeconds: 60,
  keyPrefix: "login",
});
app.post("/login", loginRateLimit, (req, res) => {
  res.json({ ok: true, replica: HOSTNAME, mensaje: "login simulado" });
});

app.listen(PORT, () => {
  console.log(`API ${HOSTNAME} escuchando en el puerto ${PORT}`);
});

const express = require("express");
const { Pool } = require("pg");
const Redis = require("ioredis");
const os = require("os");

const app = express();
app.set("trust proxy", true);

const PORT = 3000;
const HOSTNAME = os.hostname();

app.use(express.json());

// Pool de conexiones a Postgres
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Cliente de Redis
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

// ─────────────────────────────────────────────
// Middleware de rate limiting
// ─────────────────────────────────────────────
function rateLimit({ limit, windowSeconds, keyPrefix }) {
  return async (req, res, next) => {
    const ip = req.ip;
    const key = `ratelimit:${keyPrefix}:${ip}`;

    try {
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }

      const ttl = await redis.ttl(key);

      // Headers informativos (estándar de la industria)
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - count));
      res.setHeader("X-RateLimit-Reset", ttl);

      if (count > limit) {
        return res.status(429).json({
          error: "Too Many Requests",
          retryAfter: ttl,
          replica: HOSTNAME,
        });
      }

      next();
    } catch (err) {
      // Si Redis falla, decidimos qué hacer. Acá lo dejamos pasar (fail-open).
      // En producción, esto se discute mucho. Más abajo te explico.
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

app.get("/db-check", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as now");
    res.json({
      ok: true,
      replica: HOSTNAME,
      hora_db: result.rows[0].now,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      replica: HOSTNAME,
      error: err.message,
    });
  }
});

// Endpoint protegido con rate limiting
const loginRateLimit = rateLimit({
  limit: 5,
  windowSeconds: 60,
  keyPrefix: "login",
});

app.post("/login", loginRateLimit, (req, res) => {
  res.json({
    ok: true,
    replica: HOSTNAME,
    mensaje: "login simulado",
  });
});

app.listen(PORT, () => {
  console.log(`API ${HOSTNAME} escuchando en el puerto ${PORT}`);
});

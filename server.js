const express = require("express");
const { Pool } = require("pg");
const os = require("os");

const app = express();
const PORT = 3000;
const HOSTNAME = os.hostname();

app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

app.get("/health", (req, res) => {
  res.json({ ok: true, replica: HOSTNAME });
});

app.get("/slow", async (req, res) => {
  // Espera 2 segundos antes de responder
  await new Promise((resolve) => setTimeout(resolve, 2000));
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

app.listen(PORT, () => {
  console.log(`API ${HOSTNAME} escuchando en el puerto ${PORT}`);
});

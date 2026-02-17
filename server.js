const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

// DB
const db = new Database("./db/data.db");
db.pragma("foreign_keys = ON");

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "Shift Scheduler", time: new Date().toISOString() });
});

// --- MVP API: create company + manager (seed) ---
app.post("/api/bootstrap", (req, res) => {
  const { companyName, email, passwordHash, firstName, lastName } = req.body;

  if (!companyName || !email || !passwordHash || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const tx = db.transaction(() => {
    const c = db.prepare("INSERT INTO companies (name) VALUES (?)").run(companyName);
    const companyId = c.lastInsertRowid;

    const u = db.prepare(`
      INSERT INTO users (company_id, email, password_hash, role)
      VALUES (?, ?, ?, 'manager')
    `).run(companyId, email, passwordHash);

    const userId = u.lastInsertRowid;

    db.prepare(`
      INSERT INTO employees (company_id, user_id, first_name, last_name)
      VALUES (?, ?, ?, ?)
    `).run(companyId, userId, firstName, lastName);

    return { companyId, userId };
  });

  const result = tx();
  res.status(201).json(result);
});

// Frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`🚀 Shift Scheduler działa na http://localhost:${PORT}`));

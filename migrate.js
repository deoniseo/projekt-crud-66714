const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbDir = path.join(__dirname, "db");
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, "data.db"));
const sql = fs.readFileSync(path.join(__dirname, "migrations", "001_init_shift_scheduler.sql"), "utf8");
db.exec(sql);

console.log("✓ Migracja wykonana: Shift Scheduler schema gotowa.");

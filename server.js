const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("./db/data.db");

app.use(cors());
app.use(express.json());

// ====== Public folder ======
app.use(express.static("public"));

// ====== Walidacja ======
function validate(body) {
  const errors = [];
  if (!body.nazwa) errors.push("Brak nazwy.");
  if (!body.miasto) errors.push("Brak miasta.");
  if (!body.rok_zalozenia) errors.push("Brak roku założenia.");
  if (!body.budzet_mln) errors.push("Brak budżetu.");
  return errors;
}

// ====== CRUD ======
app.get("/api/druzyny", (req, res) => {
  res.json(db.prepare("SELECT * FROM druzyny").all());
});

app.get("/api/druzyny/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM druzyny WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Nie znaleziono drużyny." });
  res.json(row);
});

app.post("/api/druzyny", (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const { nazwa, miasto, rok_zalozenia, budzet_mln } = req.body;
  const info = db
    .prepare("INSERT INTO druzyny (nazwa, miasto, rok_zalozenia, budzet_mln) VALUES (?,?,?,?)")
    .run(nazwa, miasto, rok_zalozenia, budzet_mln);
  res.status(201).json(db.prepare("SELECT * FROM druzyny WHERE id=?").get(info.lastInsertRowid));
});

app.put("/api/druzyny/:id", (req, res) => {
  const istnieje = db.prepare("SELECT * FROM druzyny WHERE id=?").get(req.params.id);
  if (!istnieje) return res.status(404).json({ error: "Nie znaleziono drużyny." });
  const nowa = { ...istnieje, ...req.body };
  db.prepare(
    "UPDATE druzyny SET nazwa=?, miasto=?, rok_zalozenia=?, budzet_mln=? WHERE id=?"
  ).run(nowa.nazwa, nowa.miasto, nowa.rok_zalozenia, nowa.budzet_mln, req.params.id);
  res.json(db.prepare("SELECT * FROM druzyny WHERE id=?").get(req.params.id));
});

app.delete("/api/druzyny/:id", (req, res) => {
  const info = db.prepare("DELETE FROM druzyny WHERE id=?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Nie znaleziono drużyny." });
  res.status(204).end();
});

// ====== Główna strona ======
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`✅ Serwer działa na porcie ${PORT}`));



const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Baza danych SQLite ---
const db = new Database("./db/data.db");

// Tworzymy tabelę, jeśli jeszcze nie istnieje
db.prepare(`
  CREATE TABLE IF NOT EXISTS druzyny (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nazwa TEXT NOT NULL,
    miasto TEXT NOT NULL,
    rok_zalozenia INTEGER NOT NULL,
    budzet_mln REAL NOT NULL,
    data_rejestracji TEXT DEFAULT CURRENT_DATE
  )
`).run();

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // frontend z folderu public

/*
 * =====================================
 *  API 1 – POGODA (Open-Meteo)
 *  GET /external/weather?city=Warszawa
 * =====================================
 */

// pomocnicza: pobranie współrzędnych miasta
async function getCoordinatesForCity(city) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search" +
    `?name=${encodeURIComponent(city)}&count=1&language=pl&format=json`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error("GEOCODING_UPSTREAM_ERROR_" + resp.status);
  }

  const data = await resp.json();
  if (!data.results || data.results.length === 0) {
    return null;
  }

  const r = data.results[0];
  return {
    name: r.name,
    country: r.country,
    latitude: r.latitude,
    longitude: r.longitude,
  };
}

// pomocnicza: pobranie prognozy z Open-Meteo
async function getWeatherForCity(city) {
  const coords = await getCoordinatesForCity(city);
  if (!coords) {
    throw new Error("CITY_NOT_FOUND");
  }

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${coords.latitude}` +
    `&longitude=${coords.longitude}` +
    "&current_weather=true" +
    "&hourly=temperature_2m" +
    "&timezone=auto";

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error("WEATHER_UPSTREAM_ERROR_" + resp.status);
  }

  const data = await resp.json();

  const result = {
    city: coords.name,
    country: coords.country,
    timezone: data.timezone,
    current: data.current_weather
      ? {
          temperature: data.current_weather.temperature,
          windspeed: data.current_weather.windspeed,
          time: data.current_weather.time,
        }
      : null,
    nextHours: [],
  };

  if (data.hourly && data.hourly.time && data.hourly.temperature_2m) {
    for (let i = 0; i < Math.min(6, data.hourly.time.length); i++) {
      result.nextHours.push({
        time: data.hourly.time[i],
        temperature: data.hourly.temperature_2m[i],
      });
    }
  }

  return result;
}

// endpoint pogodowy
app.get("/external/weather", async (req, res) => {
  const city = (req.query.city || "").trim();

  if (!city) {
    return res
      .status(400)
      .json({ error: "Brak parametru 'city' (nazwa miasta)." });
  }

  try {
    const weather = await getWeatherForCity(city);
    return res.json(weather);
  } catch (err) {
    console.error("Błąd /external/weather:", err.message);

    if (err.message === "CITY_NOT_FOUND") {
      return res
        .status(400)
        .json({ error: "Nie znaleziono podanego miasta." });
    }

    if (
      err.message.startsWith("GEOCODING_UPSTREAM_ERROR_") ||
      err.message.startsWith("WEATHER_UPSTREAM_ERROR_")
    ) {
      const parts = err.message.split("_");
      const upstreamStatus = Number(parts[parts.length - 1]);

      if (upstreamStatus >= 500) {
        return res
          .status(502)
          .json({ error: "Błąd po stronie serwisu pogodowego (502)." });
      } else {
        return res
          .status(503)
          .json({ error: "Serwis pogodowy jest chwilowo niedostępny (503)." });
      }
    }

    return res
      .status(503)
      .json({ error: "Nie udało się pobrać pogody. Spróbuj ponownie." });
  }
});

/*
 * ===========================================
 *  API 2 – KURSY WALUT (exchangerate.host)
 *  GET /external/rates?base=EUR&symbols=PLN,USD
 * ===========================================
 */

function isCurrency(code) {
  return /^[A-Z]{3}$/.test(code);
}

app.get("/external/rates", async (req, res) => {
  const base = (req.query.base || "EUR").toUpperCase();
  const symbolsRaw = req.query.symbols || "PLN,USD,GBP";

  const symbols = symbolsRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (!isCurrency(base) || symbols.length === 0 || !symbols.every(isCurrency)) {
    return res
      .status(400)
      .json({ message: "Nieprawidłowe parametry walut (base / symbols)." });
  }

  const url = `https://api.exchangerate.host/latest?base=${base}&symbols=${symbols.join(
    ","
  )}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res
        .status(503)
        .json({ message: "Problem po stronie exchangerate.host (503)." });
    }

    const data = await response.json();

    const rates = Object.entries(data.rates || {}).map(([currency, rate]) => ({
      currency,
      rate,
    }));

    return res.json({
      base: data.base || base,
      date: data.date,
      rates,
    });
  } catch (err) {
    console.error("Błąd połączenia z exchangerate.host:", err);
    return res
      .status(503)
      .json({ message: "Błąd połączenia z exchangerate.host (503)." });
  }
});

/*
 * ==========================
 *       CRUD: DRUŻYNY
 * ==========================
 */

function validateTeam(body) {
  const errors = [];
  if (!body.nazwa) errors.push("Brak nazwy.");
  if (!body.miasto) errors.push("Brak miasta.");
  if (!body.rok_zalozenia) errors.push("Brak roku założenia.");
  if (!body.budzet_mln) errors.push("Brak budżetu.");
  return errors;
}

// lista
app.get("/api/druzyny", (req, res) => {
  const rows = db.prepare("SELECT * FROM druzyny").all();
  res.json(rows);
});

// pojedyncza
app.get("/api/druzyny/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM druzyny WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Nie znaleziono drużyny." });
  res.json(row);
});

// create
app.post("/api/druzyny", (req, res) => {
  const errors = validateTeam(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const { nazwa, miasto, rok_zalozenia, budzet_mln } = req.body;
  const info = db
    .prepare(
      "INSERT INTO druzyny (nazwa, miasto, rok_zalozenia, budzet_mln) VALUES (?,?,?,?)"
    )
    .run(nazwa, miasto, rok_zalozenia, budzet_mln);

  const saved = db
    .prepare("SELECT * FROM druzyny WHERE id=?")
    .get(info.lastInsertRowid);
  res.status(201).json(saved);
});

// update
app.put("/api/druzyny/:id", (req, res) => {
  const istnieje = db
    .prepare("SELECT * FROM druzyny WHERE id=?")
    .get(req.params.id);
  if (!istnieje)
    return res.status(404).json({ error: "Nie znaleziono drużyny." });

  const merged = { ...istnieje, ...req.body };

  db.prepare(
    "UPDATE druzyny SET nazwa=?, miasto=?, rok_zalozenia=?, budzet_mln=? WHERE id=?"
  ).run(
    merged.nazwa,
    merged.miasto,
    merged.rok_zalozenia,
    merged.budzet_mln,
    req.params.id
  );

  const updated = db
    .prepare("SELECT * FROM druzyny WHERE id=?")
    .get(req.params.id);
  res.json(updated);
});

// delete
app.delete("/api/druzyny/:id", (req, res) => {
  const info = db.prepare("DELETE FROM druzyny WHERE id=?").run(req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Nie znaleziono drużyny." });
  res.status(204).end();
});

// --- Strona główna ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start serwera ---
app.listen(PORT, () =>
  console.log(`✅ Serwer działa na http://localhost:${PORT}`)
);



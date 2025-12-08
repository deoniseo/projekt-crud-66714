const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("./db/data.db");

app.use(cors());
app.use(express.json());

// statyczne pliki (frontend)
app.use(express.static("public"));

/*
 * ================================
 *  INTEGRACJA Z API POGODOWYM
 *  GET /external/weather?city=Warszawa
 * ================================
 */

// pobranie współrzędnych miasta z Open-Meteo Geocoding API
async function getCoordinatesForCity(city) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search" +
    `?name=${encodeURIComponent(city)}&count=1&language=pl&format=json`;

  const resp = await fetch(url);
  if (!resp.ok) {
    // błąd po stronie geocoding API
    throw new Error("GEOCODING_UPSTREAM_ERROR_" + resp.status);
  }

  const data = await resp.json();
  if (!data.results || data.results.length === 0) {
    return null; // miasto nie znalezione
  }

  const r = data.results[0];
  return {
    name: r.name,
    country: r.country,
    latitude: r.latitude,
    longitude: r.longitude,
  };
}

// pobranie prognozy z Open-Meteo Forecast API
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

  // uproszczony JSON dla frontendu
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

// endpoint używany przez Postmana + frontend
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
        // 5xx po stronie Open-Meteo
        return res
          .status(502)
          .json({ error: "Błąd po stronie serwisu pogodowego (502)." });
      } else {
        // inne kody → 503
        return res
          .status(503)
          .json({ error: "Serwis pogodowy jest chwilowo niedostępny (503)." });
      }
    }

    // nieoczekiwany błąd
    return res
      .status(503)
      .json({ error: "Nie udało się pobrać pogody. Spróbuj ponownie." });
  }
});

// ====== EXCHANGE RATES (exchangerate.host) ======
function isCurrency(code) {
  return /^[A-Z]{3}$/.test(code);
}

app.get("/external/rates", async (req, res) => {
  const base = (req.query.base || "EUR").toUpperCase();
  const symbolsRaw = req.query.symbols || "PLN,USD,GBP";

  const symbols = symbolsRaw
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  // 400 – złe parametry
  if (!isCurrency(base) || symbols.length === 0 || !symbols.every(isCurrency)) {
    return res
      .status(400)
      .json({ message: "Nieprawidłowe parametry walut (base / symbols)." });
  }

  const url = `https://api.exchangerate.host/latest?base=${base}&symbols=${symbols.join(",")}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      // 503 – problem po stronie API
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

// ====== KURSY WALUT (exchangerate.host) ======
const ratesForm = document.getElementById("rates-form");
const ratesBase = document.getElementById("rates-base");
const ratesBox = document.getElementById("rates-box");

ratesForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const base = ratesBase.value;
  const symbols = Array.from(document.querySelectorAll('input[name="rates-symbol"]:checked'))
    .map(i => i.value)
    .join(",");

  if (!symbols) {
    ratesBox.textContent = "Wybierz przynajmniej jedną walutę.";
    return;
  }

  ratesBox.textContent = "Ładowanie kursów...";

  try {
    const res = await fetch(`/external/rates?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbols)}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      ratesBox.textContent = err.message || "Błąd podczas pobierania kursów.";
      return;
    }

    const data = await res.json();

    if (!data.rates || data.rates.length === 0) {
      ratesBox.textContent = "Brak danych o kursach.";
      return;
    }

    // Renderujemy tabelkę
    const rows = data.rates
      .map(r => `<tr><td>${r.currency}</td><td>${r.rate.toFixed(4)}</td></tr>`)
      .join("");

    ratesBox.innerHTML = `
      <div style="margin-bottom:6px;">
        Kursy względem: <strong>${data.base}</strong>, data: ${data.date || "-"}
      </div>
      <table style="border-collapse:collapse; width:100%; max-width:400px;">
        <thead>
          <tr>
            <th style="border-bottom:1px solid #ddd; text-align:left; padding:4px 6px;">Waluta</th>
            <th style="border-bottom:1px solid #ddd; text-align:left; padding:4px 6px;">Kurs</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error(err);
    ratesBox.textContent = "Błąd połączenia z serwerem.";
  }
});


/*
 * ==========================
 *         CRUD DRUŻYN
 * ==========================
 */

function validate(body) {
  const errors = [];
  if (!body.nazwa) errors.push("Brak nazwy.");
  if (!body.miasto) errors.push("Brak miasta.");
  if (!body.rok_zalozenia) errors.push("Brak roku założenia.");
  if (!body.budzet_mln) errors.push("Brak budżetu.");
  return errors;
}

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
    .prepare(
      "INSERT INTO druzyny (nazwa, miasto, rok_zalozenia, budzet_mln) VALUES (?,?,?,?)"
    )
    .run(nazwa, miasto, rok_zalozenia, budzet_mln);
  res
    .status(201)
    .json(db.prepare("SELECT * FROM druzyny WHERE id=?").get(info.lastInsertRowid));
});

app.put("/api/druzyny/:id", (req, res) => {
  const istnieje = db
    .prepare("SELECT * FROM druzyny WHERE id=?")
    .get(req.params.id);
  if (!istnieje)
    return res.status(404).json({ error: "Nie znaleziono drużyny." });

  const nowa = { ...istnieje, ...req.body };

  db.prepare(
    "UPDATE druzyny SET nazwa=?, miasto=?, rok_zalozenia=?, budzet_mln=? WHERE id=?"
  ).run(
    nowa.nazwa,
    nowa.miasto,
    nowa.rok_zalozenia,
    nowa.budzet_mln,
    req.params.id
  );

  res.json(db.prepare("SELECT * FROM druzyny WHERE id=?").get(req.params.id));
});

app.delete("/api/druzyny/:id", (req, res) => {
  const info = db.prepare("DELETE FROM druzyny WHERE id=?").run(req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Nie znaleziono drużyny." });
  res.status(204).end();
});

// strona główna
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () =>
  console.log(`✅ Serwer działa na http://localhost:${PORT}`)
);


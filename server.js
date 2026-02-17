const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // frontend

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

// pomocnicza: pobranie prognozy
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
      return res
        .status(502)
        .json({ error: "Błąd po stronie serwisu pogodowego." });
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
        .json({ message: "Problem po stronie exchangerate.host." });
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
      .json({ message: "Błąd połączenia z exchangerate.host." });
  }
});

// --- Strona główna ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start serwera ---
app.listen(PORT, () =>
  console.log(`✅ Serwer działa na http://localhost:${PORT}`)
);

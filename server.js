const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Health check (очень важно для Render и диплома)
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Shift Scheduler API",
    time: new Date().toISOString(),
  });
});

// Главная страница
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Shift Scheduler API działa na porcie ${PORT}`);
});

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const { adminRoutes, healthRoutes, publicRoutes } = require("./routes");

const app = express();

const allowlist = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) =>
    value
      .trim()
      .replace(/^['"]/, "")
      .replace(/['"]$/, "")
  )
  .filter(Boolean);
const allowAll = allowlist.includes("*") || allowlist.length === 0;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowed = allowAll || (origin && allowlist.includes(origin));

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

app.use(healthRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/admin", adminRoutes);

module.exports = { app };

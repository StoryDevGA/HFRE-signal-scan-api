const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const { adminRoutes, healthRoutes, publicRoutes } = require("./routes");

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
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

app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

morgan.token("request-id", (req) => req.requestId);

app.use(helmet());
app.use((req, res, next) => {
  if (req.path === "/api/admin/auth/logout") {
    return next();
  }
  return express.json({ limit: "1mb" })(req, res, next);
});
app.use(
  morgan(
    ":remote-addr - :method :url :status :res[content-length] - :response-time ms :request-id"
  )
);

app.use(healthRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/admin", adminRoutes);

module.exports = { app };

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const { adminRoutes, healthRoutes, publicRoutes } = require("./routes");

const app = express();

const allowlist = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({ origin: allowlist.length ? allowlist : true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

app.use(healthRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/admin", adminRoutes);

module.exports = { app };

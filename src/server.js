require("dotenv").config();

const { app } = require("./app");
const { connectToDatabase } = require("./db/connect");

const port = Number(process.env.PORT) || 8000;

async function start() {
  await connectToDatabase();
  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});

// server.js — entry point. Wires middleware + routes together.
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const adminUsers = require("./routes/adminUsers");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/admin/users", adminUsers);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));

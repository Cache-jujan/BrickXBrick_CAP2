require("dotenv").config();
const express = require("express");
const cors = require("cors");
const adminUsers = require("./routes/adminUsers");
const authRoutes = require("./routes/auth");
const { requireAuth } = require("./middleware/auth");
const syncRoutes = require("./routes/sync");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.use("/api/admin/users", adminUsers);
app.use("/api/auth", authRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));

app.use("/api/sync", syncRoutes);
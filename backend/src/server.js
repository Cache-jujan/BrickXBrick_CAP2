require("dotenv").config();
const express = require("express");
const cors = require("cors");
const adminUsers = require("./routes/adminUsers");
const authRoutes = require("./routes/auth");
const ticketRoutes = require("./routes/tickets");
const { requireAuth } = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

//Auth Routes

app.use("/api/admin/users", adminUsers);
app.use("/api/auth", authRoutes);

//Ticket Routes
app.use("/api/tickets", ticketRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message, details: err.details });
});
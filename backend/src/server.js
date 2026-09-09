require("dotenv").config();
const express = require("express");
const cors = require("cors");
const adminUsers = require("./routes/adminUsers");
const authRoutes = require("./routes/auth");
const ticketRoutes = require("./routes/tickets");
const projectRoutes = require("./routes/projects");
const { requireAuth } = require("./middleware/auth");
const syncRoutes = require("./routes/sync");
const milestoneRoutes = require("./routes/milestones");
const taskRoutes = require("./routes/tasks");


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

//Ticket Routes  (F4)
app.use("/api/tickets", ticketRoutes);

//Project Routes
app.use("/api/projects", projectRoutes);

//Milestone Routes (F3)
app.use("/api/milestones", milestoneRoutes);
app.use("/api/tasks", taskRoutes);

app.use("/api/sync", syncRoutes);
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message, details: err.details });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));

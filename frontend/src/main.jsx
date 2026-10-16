// Must run first: moves Supabase email links to /set-password before the
// router or the Supabase client reads the URL (see the file for why).
import "./auth/authLinkRedirect";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
// Loaded last so its app-wide refinements win over per-page styles.
import "./styles/polish.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

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

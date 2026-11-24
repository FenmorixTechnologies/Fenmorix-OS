import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate.jsx";

// No <React.StrictMode>: the app's loading code was written for the artifact
// environment, which runs each startup effect once. StrictMode runs them twice
// in development, and the second load can undo changes made in between.
// /display = a TV display screen: no person signs in there (see Display.jsx). Loaded only on that page, after the app's
// modules, so it doesn't change their import order (App.jsx has circular imports).
const root = createRoot(document.getElementById("root"));
if (window.location.pathname.replace(/\/+$/, "") === "/display") import("./Display.jsx").then(m => root.render(<m.default />));
else root.render(<AuthGate />);

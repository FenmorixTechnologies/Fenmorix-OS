// Client portal page (portal.html): its own small bundle. Never imports the office app (App.jsx) or anything vendor-internal.
import React from "react";
import { createRoot } from "react-dom/client";
import Portal from "./Portal.jsx";
createRoot(document.getElementById("root")).render(<Portal />);

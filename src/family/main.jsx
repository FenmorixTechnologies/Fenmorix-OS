// Gradebook family page (grades.html, served at /grades): students and parents / guardians. Its own small bundle.
// Never imports the staff app (App.jsx) or anything else signed-in staff use.
import React from "react";
import { createRoot } from "react-dom/client";
import Family from "./Family.jsx";
createRoot(document.getElementById("root")).render(<Family />);

// The signed-out page's own small bundle (signin.html). The server sends this page, not the app, to anyone who isn't signed in.
import React from "react";
import { createRoot } from "react-dom/client";
import SignInRoot from "./SignIn.jsx";

createRoot(document.getElementById("root")).render(<SignInRoot />);

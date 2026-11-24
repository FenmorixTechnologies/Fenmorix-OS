import React from "react";
const box = name => (p) => React.createElement("div", { "data-chart": name }, p.children);
export const ResponsiveContainer = box("ResponsiveContainer"), BarChart = box("BarChart"), LineChart = box("LineChart");
export const Bar = () => null, Line = () => null, XAxis = () => null, YAxis = () => null, CartesianGrid = () => null, Tooltip = () => null, Legend = () => null, Cell = () => null;

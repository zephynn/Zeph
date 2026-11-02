import "./style.css";
import "./lib/liquidGlass";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

import "./style.css";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

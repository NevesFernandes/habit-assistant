// Saves text as a file from the browser (a Blob behind a temporary <a download>), for §72's
// CSV and §82's JSON backup alike. Works in the installed Android PWA and on desktop.
export function saveTextFile(filename: string, text: string): void {
  const isCsv = filename.toLowerCase().endsWith(".csv");
  // The byte-order mark makes Excel read a CSV as UTF-8, so accents and emoji come through.
  const blob = isCsv
    ? new Blob(["﻿", text], { type: "text/csv;charset=utf-8" })
    : new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

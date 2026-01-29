import type { jsPDF } from "jspdf";

// Ensure Romanian diacritics render correctly in exported PDFs.
// jsPDF's built-in fonts don't include many Unicode glyphs (ă, â, î, ș, ț),
// so we embed DejaVuSans (regular + bold) into the PDF.

let cached: { regular: string; bold: string } | null = null;

function arrayBufferToBase64(buf: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

async function fetchFontBase64(url: URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nu pot încărca fontul pentru PDF: ${url.toString()}`);
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

export async function ensurePdfFonts(doc: jsPDF) {
  // If fonts were already registered in this doc instance, skip.
  const list = (doc as any).getFontList?.() as Record<string, string[]> | undefined;
  if (list?.DejaVuSans?.includes("normal") && list?.DejaVuSans?.includes("bold")) return;

  if (!cached) {
    const regularUrl = new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url);
    const boldUrl = new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url);
    const [regular, bold] = await Promise.all([fetchFontBase64(regularUrl), fetchFontBase64(boldUrl)]);
    cached = { regular, bold };
  }

  doc.addFileToVFS("DejaVuSans.ttf", cached.regular);
  doc.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");

  doc.addFileToVFS("DejaVuSans-Bold.ttf", cached.bold);
  doc.addFont("DejaVuSans-Bold.ttf", "DejaVuSans", "bold");
}

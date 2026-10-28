'use client';

/** Fereastra de tipărire; de acolo, „Salvează ca PDF". */
export default function Tipareste() {
  return <button type="button" className="buton nu-tipari" onClick={() => window.print()}>Tipărește / salvează PDF</button>;
}

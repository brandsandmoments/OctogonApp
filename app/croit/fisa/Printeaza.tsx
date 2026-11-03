'use client';

/** Butonul de printat foaia (nu apare pe hârtie). */
export default function Printeaza() {
  return <button type="button" className="principal" onClick={() => window.print()}>Printează (A4)</button>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const defaultForm = {
  text: '',
  x: '80',
  y: '80',
  size: '18',
  color: '#c62828',
};

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

export default function App() {
  const canvasRef = useRef(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [pdfName, setPdfName] = useState('upraveny-dokument.pdf');
  const [pdfProxy, setPdfProxy] = useState(null);
  const [pageSizes, setPageSizes] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [annotations, setAnnotations] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [status, setStatus] = useState('Nahrajte PDF dokument pro začátek.');

  const pageCount = pdfProxy?.numPages ?? 0;
  const pageAnnotations = useMemo(
    () => annotations.filter((item) => item.page === currentPage),
    [annotations, currentPage],
  );

  useEffect(() => {
    if (!pdfProxy || !canvasRef.current) {
      return;
    }

    let canceled = false;

    async function renderPage() {
      const page = await pdfProxy.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      if (canceled) {
        return;
      }

      pageAnnotations.forEach((item) => {
        context.fillStyle = item.color;
        context.font = `${item.size}px Arial`;
        context.fillText(item.text, item.x, item.y);
      });
    }

    renderPage().catch(() => {
      setStatus('Nepodařilo se vykreslit stránku PDF.');
    });

    return () => {
      canceled = true;
    };
  }, [pdfProxy, currentPage, pageAnnotations]);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const bytes = await file.arrayBuffer();
      const task = pdfjsLib.getDocument({ data: bytes });
      const loadedPdf = await task.promise;
      const dimensions = [];

      for (let index = 1; index <= loadedPdf.numPages; index += 1) {
        const page = await loadedPdf.getPage(index);
        const view = page.view;
        dimensions.push({ width: view[2], height: view[3] });
      }

      setPdfBytes(bytes);
      setPdfProxy(loadedPdf);
      setPageSizes(dimensions);
      setCurrentPage(1);
      setAnnotations([]);
      setPdfName(file.name.replace(/\.pdf$/i, '') + '-edited.pdf');
      setStatus(`Dokument ${file.name} je připravený k editaci.`);
    } catch {
      setStatus('Soubor není validní PDF nebo se ho nepodařilo načíst.');
    }
  }

  function handleAddAnnotation() {
    if (!form.text.trim()) {
      setStatus('Nejprve zadejte text, který chcete vložit do dokumentu.');
      return;
    }

    setAnnotations((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        page: currentPage,
        text: form.text,
        x: Number(form.x),
        y: Number(form.y),
        size: Number(form.size),
        color: form.color,
      },
    ]);

    setForm((prev) => ({ ...prev, text: '' }));
    setStatus('Text byl přidán do seznamu úprav.');
  }

  function removeAnnotation(id) {
    setAnnotations((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleExport() {
    if (!pdfBytes) {
      setStatus('Nejprve nahrajte PDF soubor.');
      return;
    }

    try {
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();

      annotations.forEach((item) => {
        const page = pages[item.page - 1];
        const size = pageSizes[item.page - 1];
        const { r, g, b } = hexToRgb(item.color);

        page.drawText(item.text, {
          x: item.x,
          y: size.height - item.y,
          size: item.size,
          color: rgb(r, g, b),
        });
      });

      const edited = await pdfDoc.save();
      const blob = new Blob([edited], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = pdfName;
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Upravené PDF bylo úspěšně exportováno.');
    } catch {
      setStatus('Při exportu upraveného PDF nastala chyba.');
    }
  }

  return (
    <main>
      <h1>React PDF editor</h1>
      <p className="status">{status}</p>

      <section className="controls">
        <label>
          1) Nahrát PDF
          <input type="file" accept="application/pdf" onChange={handleUpload} />
        </label>

        <label>
          2) Stránka
          <input
            type="number"
            min="1"
            max={Math.max(pageCount, 1)}
            value={currentPage}
            onChange={(event) => setCurrentPage(Number(event.target.value))}
            disabled={!pdfProxy}
          />
          <span className="hint">z {pageCount || 0}</span>
        </label>
      </section>

      <section className="editor-grid">
        <div className="preview-panel">
          <h2>Náhled stránky</h2>
          <canvas ref={canvasRef} />
        </div>

        <div className="edit-panel">
          <h2>3) Přidat text do PDF</h2>
          <label>
            Text
            <input
              value={form.text}
              onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Např. Schváleno"
            />
          </label>

          <div className="split">
            <label>
              X
              <input
                type="number"
                value={form.x}
                onChange={(event) => setForm((prev) => ({ ...prev, x: event.target.value }))}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                value={form.y}
                onChange={(event) => setForm((prev) => ({ ...prev, y: event.target.value }))}
              />
            </label>
          </div>

          <div className="split">
            <label>
              Velikost písma
              <input
                type="number"
                value={form.size}
                onChange={(event) => setForm((prev) => ({ ...prev, size: event.target.value }))}
              />
            </label>
            <label>
              Barva
              <input
                type="color"
                value={form.color}
                onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
              />
            </label>
          </div>

          <button onClick={handleAddAnnotation} disabled={!pdfProxy}>
            Přidat text
          </button>

          <h3>Seznam úprav</h3>
          <ul>
            {pageAnnotations.length === 0 && <li>Na této stránce zatím nejsou žádné úpravy.</li>}
            {pageAnnotations.map((item) => (
              <li key={item.id}>
                <strong>{item.text}</strong> ({item.x}, {item.y})
                <button onClick={() => removeAnnotation(item.id)}>Smazat</button>
              </li>
            ))}
          </ul>

          <label>
            Název exportu
            <input value={pdfName} onChange={(event) => setPdfName(event.target.value)} />
          </label>

          <button className="primary" onClick={handleExport} disabled={!pdfProxy}>
            4) Exportovat upravené PDF
          </button>
        </div>
      </section>
    </main>
  );
}

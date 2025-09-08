import { useState } from "react";
import { Modal } from "./components/Modal";
import { CollageEditor } from "./components/CollageEditor";

type SavedImage = { src: string; caption?: string };

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [fileToEdit, setFileToEdit] = useState<File | null>(null);
  const [reeditSrc, setReeditSrc] = useState<string | null>(null);
  const [images, setImages] = useState<SavedImage[]>([]);

  const onPick = (f: File) => {
    setReeditSrc(null);
    setFileToEdit(f);
    setIsOpen(true);
  };

  const onSave = (src: string, caption: string) => {
    setImages((prev) => [{ src, caption }, ...prev]);
    setIsOpen(false);
    setFileToEdit(null);
    setReeditSrc(null);
  };

  const onCancel = () => {
    setIsOpen(false);
    setFileToEdit(null);
    setReeditSrc(null);
  };

  return (
    <div className="page">
      <header className="topbar">
        <h1>Mini Collage</h1>
        <label className="add-btn">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.currentTarget.value = "";
            }}
          />
          ➕ Adicionar imagem
        </label>
      </header>

      <main className="gallery">
        {images.length === 0 ? (
          <div className="empty">Nenhuma imagem ainda.</div>
        ) : (
          <div className="grid">
            {images.map((img, i) => (
              <figure
                key={i}
                className="card"
                onClick={() => {
                  setFileToEdit(null);
                  setReeditSrc(img.src);
                  setIsOpen(true);
                }}
              >
                <img src={img.src} alt={img.caption || `Imagem ${i + 1}`} />
                {img.caption?.trim() && (
                  <figcaption className="caption">{img.caption}</figcaption>
                )}
              </figure>
            ))}
          </div>
        )}
      </main>

      {isOpen && (fileToEdit || reeditSrc) && (
        <Modal onClose={onCancel} fullScreen>
          <CollageEditor
            file={fileToEdit ?? undefined}
            initialSrc={reeditSrc ?? undefined}
            onSave={onSave}
            onCancel={onCancel}
          />
        </Modal>
      )}
    </div>
  );
}

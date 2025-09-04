import React, { useState } from "react";
import { Modal } from "./components/Modal";
import { CollageEditor } from "./components/CollageEditor";

type SavedImage = { src: string; caption?: string };

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [fileToEdit, setFileToEdit] = useState<File | null>(null);
  const [images, setImages] = useState<SavedImage[]>([]);

  const onPick = (f: File) => {
    setFileToEdit(f);
    setIsOpen(true);
  };

  const onSave = (src: string, caption: string) => {
    setImages((prev) => [{ src, caption }, ...prev]);
    setIsOpen(false);
    setFileToEdit(null);
  };

  const onCancel = () => {
    setIsOpen(false);
    setFileToEdit(null);
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
              <figure key={i} className="card">
                <img src={img.src} alt={img.caption || `Imagem ${i + 1}`} />
                {img.caption?.trim() && (
                  <figcaption className="caption">{img.caption}</figcaption>
                )}
              </figure>
            ))}
          </div>
        )}
      </main>

      {isOpen && fileToEdit && (
        <Modal onClose={onCancel} fullScreen>
          <CollageEditor file={fileToEdit} onSave={onSave} onCancel={onCancel} />
        </Modal>
      )}
    </div>
  );
}

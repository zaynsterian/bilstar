import { useEffect } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
};

export default function Modal({ open, title, children, onClose }: ModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    // lock page scroll behind the modal
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.35)",
        zIndex: 9999,

        // ✅ IMPORTANT: allow scrolling when content is taller than viewport
        overflowY: "auto",

        // layout
        display: "grid",
        placeItems: "start center",
        padding: 16,
      }}
      onMouseDown={onClose}
    >
      <div
        className="card card-pad"
        style={{
          width: 720,
          maxWidth: "100%",

          // ✅ IMPORTANT: keep modal inside viewport and scroll its body
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header (fixed) */}
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            marginBottom: 10,
            flex: "0 0 auto",
          }}
        >
          <div style={{ fontWeight: 950, fontSize: 16 }}>{title}</div>
          <button className="btn" onClick={onClose}>
            Închide
          </button>
        </div>

        {/* Body (scrollable) */}
        <div
          style={{
            flex: "1 1 auto",
            overflowY: "auto",
            paddingRight: 4, // small space for scrollbar
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { Modal } from "../shared/Modal";
import { LegalDocumentBody } from "./LegalDocumentBody";

// Presented OVER the current page (signup, in practice) so closing it never
// navigates anywhere — whatever the caller already had on screen (typed form
// fields included) is simply still there, untouched, underneath.
export function LegalModal({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal onClose={onClose} labelledBy="legal-title" maxWidth={640}>
      <div className="max-h-[80vh] overflow-y-auto px-6 py-8 sm:px-8">
        <LegalDocumentBody />
      </div>
    </Modal>
  );
}

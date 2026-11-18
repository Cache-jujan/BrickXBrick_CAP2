import { useState } from "react";
import "./TaskFileDrop.css";

// Same limits as TaskDocumentsDialog and the backend (POST /api/tasks/:id/documents).
export const DROP_MAX_BYTES = 10 * 1024 * 1024;
export const DROP_ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

// Returns the message key of the first problem with a dropped file, or "" when it can be uploaded.
export function checkDroppedFile(file) {
  if (!DROP_ALLOWED_TYPES.includes(file.type)) return "docs.err_type";
  if (file.size > DROP_MAX_BYTES) return "docs.err_size";
  return "";
}

// A drag only counts when it carries files from the computer, not selected text,
// a link, or an element of the page itself.
function carriesFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

// Makes one element (a timeline row, a board card) accept files dropped on it.
//   enabled  false -> the element is left alone (no handlers, no highlight).
//   accepts  false -> the drag shows a "not allowed" cursor and the drop is ignored.
//   onFiles  called with the dropped files (an array) when a drop is accepted.
// Spread `dropProps` on the element and use `isOver` to style it while a file is above it.
export function useTaskFileDrop({ enabled, accepts, onFiles }) {
  const [isOver, setIsOver] = useState(false);
  if (!enabled) return { isOver: false, dropProps: {} };

  return {
    isOver: isOver && accepts,
    dropProps: {
      onDragEnter(event) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (accepts) setIsOver(true);
      },
      onDragOver(event) {
        if (!carriesFiles(event)) return;
        // Without preventDefault the browser refuses the drop (and would open the file in this tab).
        event.preventDefault();
        event.dataTransfer.dropEffect = accepts ? "copy" : "none";
        if (accepts && !isOver) setIsOver(true);
      },
      onDragLeave(event) {
        // Moving onto a child of the element also fires dragleave; only clear when truly leaving it.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setIsOver(false);
      },
      onDrop(event) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setIsOver(false);
        if (!accepts) return;
        const files = Array.from(event.dataTransfer.files || []);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}
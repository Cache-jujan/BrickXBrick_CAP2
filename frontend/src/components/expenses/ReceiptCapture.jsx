import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ReceiptCapture.css";

// True on phones and tablets (touch is the main input). There the browser's own camera
// (file input with capture) is best: it opens the real camera app at full quality.
const usesTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const canUseWebcam = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/**
 * "Capture with camera" on a computer: a live preview from the webcam with a Take photo button.
 * A file input with `capture` only opens the camera on phones; on a computer it opens the
 * file explorer, which is what this replaces.
 */
function CameraModal({ onPhoto, onClose, onChoose }) {
  const { t } = useLocale();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("starting"); // starting | live | denied | error

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
        setState("live");
      } catch (error) {
        if (!cancelled) setState(error?.name === "NotAllowedError" || error?.name === "SecurityError" ? "denied" : "error");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop()); // switch the camera light off
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function snap() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onPhoto(new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal camera-modal" role="dialog" aria-modal="true" aria-labelledby="camera-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="camera-title" className="modal-title">{t("cam.title")}</h2>
        <div className="camera-stage">
          <video ref={videoRef} className="camera-video" playsInline muted />
          {state === "starting" && <p className="camera-note">{t("cam.starting")}</p>}
          {state === "denied" && <p className="camera-note">{t("cam.denied")}</p>}
          {state === "error" && <p className="camera-note">{t("cam.error")}</p>}
        </div>
        {state === "live" && <p className="camera-hint">{t("cam.hint")}</p>}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          {(state === "denied" || state === "error") && (
            <Button type="button" variant="secondary" onClick={onChoose}>{t("cam.choose_instead")}</Button>
          )}
          <Button type="button" onClick={snap} disabled={state !== "live"}>{t("cam.take")}</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The three ways to add a receipt: capture with the camera, choose an image, choose a PDF.
 * Calls onFile(file) with whichever the user ends up with.
 *
 * @param {{ onFile: (file: File) => void, disabled?: boolean, uploading?: boolean }} props
 */
export function ReceiptCapture({ onFile, disabled, uploading }) {
  const { t } = useLocale();
  const cameraInput = useRef(null);
  const imageInput = useRef(null);
  const pdfInput = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  function picked(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file);
  }

  function openCamera() {
    // Phones: the browser's own camera. Computers with a webcam: our preview. Otherwise the file chooser.
    if (!usesTouch() && canUseWebcam()) setCameraOpen(true);
    else cameraInput.current?.click();
  }

  return (
    <>
      {/* image/* (not just jpeg/png) so phones, iPhones included, open the camera instead of a chooser. */}
      <input ref={cameraInput} className="submit-expense-hidden-input" type="file" accept="image/*" capture="environment" onChange={picked} />
      <input ref={imageInput} className="submit-expense-hidden-input" type="file" accept="image/jpeg,image/png" onChange={picked} />
      <input ref={pdfInput} className="submit-expense-hidden-input" type="file" accept="application/pdf,.pdf" onChange={picked} />

      <div className="submit-expense-upload-actions">
        <Button type="button" onClick={openCamera} disabled={disabled}>{t("submit.capture_camera")}</Button>
        <Button type="button" variant="secondary" onClick={() => imageInput.current?.click()} disabled={disabled}>{t("submit.choose_image")}</Button>
        <Button type="button" variant="secondary" onClick={() => pdfInput.current?.click()} disabled={disabled}>{t("submit.choose_pdf")}</Button>
        {uploading && <span className="submit-expense-progress" role="status">{t("scan.uploading")}</span>}
      </div>

      {/* In a portal: the receipt column is sticky (its own stacking layer), so inside it the popup
          would sit underneath the form fields next to it. On <body> it covers the whole page. */}
      {cameraOpen && createPortal(
        <CameraModal
          onClose={() => setCameraOpen(false)}
          onPhoto={(file) => { setCameraOpen(false); onFile(file); }}
          onChoose={() => { setCameraOpen(false); imageInput.current?.click(); }}
        />,
        document.body
      )}
    </>
  );
}

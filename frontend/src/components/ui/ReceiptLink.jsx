import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";

// Stored receipts are private: the image URL only loads with a short-lived
// signed link from GET /api/receipts/link.
async function fetchSignedUrl(url) {
  const { data } = await apiClient.get("/api/receipts/link", { params: { url } });
  return data.url;
}

// Opens the receipt in a new tab. The tab is opened first, inside the click,
// so popup blockers allow it, then pointed at the signed link.
export function ReceiptLink({ url, className, children = "View receipt image" }) {
  const [error, setError] = useState(false);

  async function open(event) {
    event.preventDefault();
    setError(false);
    const tab = window.open("", "_blank");
    try {
      const signed = await fetchSignedUrl(url);
      if (tab) {
        tab.opener = null;
        tab.location.href = signed;
      } else {
        window.location.href = signed;
      }
    } catch {
      tab?.close();
      setError(true);
    }
  }

  return (
    <>
      <a href={url} className={className} onClick={open} rel="noreferrer">{children}</a>
      {error && <span role="alert"> Couldn't open the receipt.</span>}
    </>
  );
}

// The signed link for an <img>/<iframe> preview ("" until it arrives).
export function useSignedReceiptUrl(url) {
  const [signed, setSigned] = useState("");
  useEffect(() => {
    setSigned("");
    if (!url) return undefined;
    let cancelled = false;
    fetchSignedUrl(url).then((u) => { if (!cancelled) setSigned(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  return signed;
}

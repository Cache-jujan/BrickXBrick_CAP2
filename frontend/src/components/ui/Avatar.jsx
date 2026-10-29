import { useEffect, useState } from "react";

/** A profile picture, or the person's first letter when there is none (or it can't load). */
export function Avatar({ url, initial, className }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  return (
    <span className={className} aria-hidden="true">
      {url && !broken ? (
        <img src={url} alt="" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
      ) : initial}
    </span>
  );
}

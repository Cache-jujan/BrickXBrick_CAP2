import { useEffect, useRef, useState } from "react";

/**
 * A profile picture, or the person's first letter when there is none (or it can't load).
 * While a picture is still downloading the letter stays visible and the picture fades in over it,
 * so the circle is never just an empty coloured disc.
 */
export function Avatar({ url, initial, className }) {
  const [state, setState] = useState("loading"); // loading | ready | broken
  const img = useRef(null);
  useEffect(() => {
    // A picture that is already cached has finished loading before React can listen for it.
    setState(img.current?.complete && img.current.naturalWidth > 0 ? "ready" : "loading");
  }, [url]);
  const showPicture = Boolean(url) && state !== "broken";
  return (
    <span className={className} style={{ position: "relative" }} aria-hidden="true">
      {state !== "ready" || !url ? initial : null}
      {showPicture && (
        <img
          ref={img}
          src={url}
          alt=""
          onLoad={() => setState("ready")}
          onError={() => setState("broken")}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", opacity: state === "ready" ? 1 : 0, transition: "opacity 0.2s ease" }}
        />
      )}
    </span>
  );
}

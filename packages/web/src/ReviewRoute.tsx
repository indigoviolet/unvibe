/** Review route: shell + WS subscription + floating UI slots. */
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { connectEvents } from "./api/ws.js";
import { GuideThreadHooks } from "./comments/GuideThreads.js";
import { HoverPopover } from "./floating/HoverPopover.js";
import { SelectionToolbar } from "./floating/SelectionToolbar.js";
import { Toast } from "./floating/Toast.js";
import { Tooltip } from "./floating/Tooltip.js";
import { AppShell } from "./shell/AppShell.js";
import { useReview } from "./state/store.js";

export function ReviewRoute() {
  const { id } = useParams<{ id: string }>();
  const reviewId = id ?? "demo";
  const applyEvent = useReview((s) => s.applyEvent);
  const setConnected = useReview((s) => s.setConnected);

  useEffect(() => {
    return connectEvents({ reviewId, onEvent: applyEvent, onStatus: setConnected });
  }, [reviewId, applyEvent, setConnected]);

  return (
    <>
      <AppShell reviewId={reviewId} />
      <GuideThreadHooks />
      <HoverPopover />
      <Tooltip />
      <SelectionToolbar />
      <Toast />
    </>
  );
}

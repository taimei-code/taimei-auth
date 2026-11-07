import { useEffect, useEffectEvent, useRef } from "react";

import { useRefreshAndWait } from "../shared/atom-runtime";
import { notifyAfterRefresh } from "../shared/notify";
import { mfaStatusAtom } from "./mfa-atom";

export const ENROLL_HOST_ID = "mfa-enroll-host";
const ENROLL_CONTAINER_ID = "mfa-enroll-root";

export const MfaEnrollDialog = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const refreshStatus = useRefreshAndWait(mfaStatusAtom);
  const notifyEnabled = useEffectEvent(() => {
    void notifyAfterRefresh(refreshStatus, {
      done: "多要素認証 (MFA) を有効にしました。",
      staleShort: "多要素認証 (MFA) を有効にしました",
    });
  });

  useEffect(() => {
    const host = containerRef.current;
    if (host === null) return;
    const container = document.createElement("div");
    container.id = ENROLL_CONTAINER_ID;
    host.append(container);
    let unmounted = false;
    const embedded = import("./mfa-enroll-program").then(({ embedEnrollElement }) => {
      if (unmounted) return () => {};
      const handle = embedEnrollElement(container);
      const unsubscribe = handle.ports.enabledAndClosed.subscribe(notifyEnabled);
      return () => {
        unsubscribe();
        handle.dispose();
      };
    });
    return () => {
      unmounted = true;
      void embedded.then((release) => {
        release();
        container.remove();
      });
    };
  }, []);

  return <div id={ENROLL_HOST_ID} ref={containerRef} />;
};

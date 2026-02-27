import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

export function useLiveUpdates(onStateChange) {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL, {
        transports: ["websocket"],
      });

      socketRef.current.on("connect", () => {
        console.log("Socket connected");
      });
    }

    const socket = socketRef.current;

    const handleUpdate = () => {
      console.log("Assets updated event received");
      if (onStateChange) {
        onStateChange();
      }
    };

    socket.on("assets:updated", handleUpdate);

    return () => {
      socket.off("assets:updated", handleUpdate);
    };
  }, [onStateChange]);
}

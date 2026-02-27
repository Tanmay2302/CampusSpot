let ioInstance = null;

export const initializeSocket = (io) => {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
};

export const broadcastAssetsUpdate = () => {
  if (ioInstance) {
    // Notify all clients to refresh asset data
    ioInstance.emit("assets:updated");
  }
};

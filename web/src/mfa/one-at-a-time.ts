export const oneAtATime = () => {
  let running = false;
  return (run: () => Promise<unknown>): boolean => {
    if (running) return false;
    running = true;
    try {
      void run().finally(() => {
        running = false;
      });
    } catch (error) {
      running = false;
      throw error;
    }
    return true;
  };
};

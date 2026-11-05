/** Events this package adds to the engine's GameEvents (declaration merging). */
declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    /** Connected to a room and playing in it. */
    'net:attached': { code: string; host: boolean };
    'net:peer-joined': { id: string; name: string };
    'net:peer-left': { id: string; name: string };
    /** The room ended (the host left, or you closed it). */
    'net:closed': { reason: string };
  }
}

export {};

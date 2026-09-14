declare module "ws" {
  const WebSocket: {
    new(url: string | URL, options?: { headers?: Record<string, string> }): globalThis.WebSocket
  }
  export default WebSocket
}

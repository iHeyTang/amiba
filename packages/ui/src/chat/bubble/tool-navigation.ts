/** Conversation-local navigation. Execution groups expand before the row is revealed. */
export function createToolNavigation() {
  let snapshot = {callId:"",version:0};
  const listeners = new Set<()=>void>();
  return {
    getSnapshot:()=>snapshot,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
    reveal:(callId:string)=>{snapshot={callId,version:snapshot.version+1};for(const listener of listeners)listener();},
  };
}
export type ToolNavigation = ReturnType<typeof createToolNavigation>;

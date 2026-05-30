export { default as HomeView, type HomeViewProps } from "./HomeView"
// WallpaperCredit moved to @hermes-x/chat-ui; re-exported here so older
// imports keep resolving until call sites switch to the chat-ui path.
export {
  WallpaperBackdrop,
  WallpaperCredit,
  wallpaperAmbientTextClass,
} from "@hermes-x/chat-ui"
export * from "./capabilities"

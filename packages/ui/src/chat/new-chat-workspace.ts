import { createContext, useContext } from "react";

/** A fresh object is a new navigation request, even for the same directory. */
export interface NewChatWorkspaceRequest {
  path: string | null;
}
export const NewChatWorkspaceContext =
  createContext<NewChatWorkspaceRequest | null>(null);
export const useNewChatWorkspace = () => useContext(NewChatWorkspaceContext);

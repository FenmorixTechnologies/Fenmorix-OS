// Who's signed in, shared with every screen (the side bar footer shows it).
import { createContext, useContext } from "react";

export const SessionContext = createContext({ user: null, pendingCount: 0, changePassword: () => {}, signOut: () => {} });
export const useSession = () => useContext(SessionContext);

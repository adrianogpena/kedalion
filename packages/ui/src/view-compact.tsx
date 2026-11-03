import { createContext, useContext } from 'react';

const ViewCompactContext = createContext(false);

/** Wraps a view rendered in the app side panel: its screen reads `useViewCompact()` and shows the reduced version. */
export const ViewCompactProvider = ViewCompactContext.Provider;

/** True when the view is shown in the side panel (compact), false in its own screen. */
export function useViewCompact(): boolean {
  return useContext(ViewCompactContext);
}

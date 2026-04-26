import { create } from 'zustand';

const useProjectStore = create((set) => ({
  project: { name: null, branch: null },

  ui: {
    nodeEditorOpen: false,
    codePanelOpen: false,
    activeSideTab: null,
  },

  setProject: (project) => set({ project }),

  toggleNodeEditor: () =>
    set((state) => ({
      ui: { ...state.ui, nodeEditorOpen: !state.ui.nodeEditorOpen },
    })),

  openNodeEditor: () =>
    set((state) => ({
      ui: { ...state.ui, nodeEditorOpen: true },
    })),

  closeNodeEditor: () =>
    set((state) => ({
      ui: { ...state.ui, nodeEditorOpen: false },
    })),

  toggleCodePanel: () =>
    set((state) => ({
      ui: { ...state.ui, codePanelOpen: !state.ui.codePanelOpen },
    })),

  closeCodePanel: () =>
    set((state) =>
      state.ui.codePanelOpen
        ? { ui: { ...state.ui, codePanelOpen: false } }
        : state,
    ),

  setActiveSideTab: (tab) =>
    set((state) => ({
      ui: { ...state.ui, activeSideTab: tab },
    })),
}));

export default useProjectStore;

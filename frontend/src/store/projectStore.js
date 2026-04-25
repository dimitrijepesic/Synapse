import { create } from 'zustand';
import { defaultProject } from '../data/mockData';

const useProjectStore = create((set) => ({
  project: { ...defaultProject },

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

  setActiveSideTab: (tab) =>
    set((state) => ({
      ui: { ...state.ui, activeSideTab: tab },
    })),
}));

export default useProjectStore;

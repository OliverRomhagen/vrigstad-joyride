declare global {
  namespace App {
    interface PageState {
      /** the phone's menu drawer is open: a shallow history entry, so going back closes it (routes/+layout.svelte) */
      menu?: boolean;
    }
  }
}

export {};

declare global {
  namespace App {
    interface PageState {
      /** the phone's menu drawer is open: a shallow history entry, so going back closes it (routes/+layout.svelte) */
      menu?: boolean;
    }
    interface PageData {
      /** the page draws its own header and footer, not the wiki's (the marketing page, routes/about/) */
      ownShell?: boolean;
    }
  }
}

export {};

/** Chromium flags for the lab browser on a small container: PDF, thumbnails and the variant axe scan. */
export const LAB_CHROMIUM_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--dns-prefetch-disable',
];

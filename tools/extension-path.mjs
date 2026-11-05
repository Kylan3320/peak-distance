import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const extensionPath = process.env.PEAK_DISTANCE_UI_EXTENSION
  ? resolve(process.env.PEAK_DISTANCE_UI_EXTENSION)
  : fileURLToPath(new URL('../.output/build/chrome-mv3', import.meta.url));

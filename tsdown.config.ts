import { defineConfig } from 'tsdown'

export default defineConfig({
  deps: {
    // Provided by omp at runtime
    neverBundle: ['@oh-my-pi/pi-ai'],
    // Marketplace and git installs copy the repository without installing dependencies
    onlyBundle: ['valibot', 'picomatch'],
  },
})

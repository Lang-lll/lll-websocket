import { defineConfig } from '@l-comedy/core'

export default defineConfig({
  plugins: ['route'],
  port: 9201,
  route: {
    routes: [
      {
        path: '/',
        component: '@/views/Home',
      },
    ],
  },
})

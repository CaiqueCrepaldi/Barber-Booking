import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      SESSION_SECRET: 'test-secret-key-for-vitest-testing-long!',
      MYSQL_PASSWORD: 'test-password',
      MYSQL_HOST: 'localhost',
      MYSQL_USER: 'root',
      MYSQL_DATABASE: 'barbearia_db',
      MYSQL_PORT: '3306',
      MYSQL_SSL: 'false',
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: 'admin123',
    },
  },
})

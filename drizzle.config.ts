import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: [
    './src/shared/db/schema.ts',
    './src/shared/db/assignment-activity-schema.ts',
  ],
  out: './src/main/database/migrations',
  dbCredentials: {
    url: './data/app.db',
  },
  strict: true,
  verbose: true,
});

// Runs before any test module is imported: AppModule validates config at import time.
process.env.TEST_DATABASE_URL ??= 'postgres://agrowth:agrowth@localhost:5432/agrowth_test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
process.env.PII_HASH_PEPPER ??= 'test-pepper-that-is-at-least-32-characters-long';

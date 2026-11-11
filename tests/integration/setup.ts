// Point the app's Prisma client at the test database before anything imports it.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("Set TEST_DATABASE_URL to an empty PostgreSQL database for integration tests (it is wiped repeatedly).");
}
process.env.DATABASE_URL = url;
